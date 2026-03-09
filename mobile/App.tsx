import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import {
  Alert,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Notifications from "expo-notifications";

type TabKey = "home" | "alerts" | "create" | "me";
type AlertType = "price" | "wallet" | "nft";
type AlertStatus = "active" | "triggered" | "paused";
type WalletWatchKind = "receive_transfer" | "send_transfer" | "new_token" | "receive_nft";
type PriceDirection = "above" | "below";
type NftCollection = "Mad Lads" | "Claynosaurz" | "Okay Bears";
type Lang = "en" | "zh";

type RadarAlert = {
  id: string;
  name: string;
  type: AlertType;
  status: AlertStatus;
  target: string;
  condition: string;
  lastCheckedAt: string;
  lastTriggeredAt?: string;
  walletWatchKind?: WalletWatchKind;
};

type PriceAlertRecord = {
  id: string;
  name: string;
  pair: string;
  direction: "above" | "below";
  targetPrice: number;
  status: "active" | "triggered" | "paused";
  currentPrice?: number;
  lastCheckedAt?: string;
  lastTriggeredAt?: string;
};

type WalletAlertRecord = {
  id: string;
  name: string;
  walletAddress: string;
  watchKind: WalletWatchKind;
  status: "active" | "triggered" | "paused";
  lastSeenBalanceLamports?: number;
  lastCheckedAt?: string;
  lastTriggeredAt?: string;
};

type RadarStatus = {
  priceAlertIntervalMs: number;
  priceAlertCount: number;
  recentEventCount?: number;
};

type SignInResultRecord = {
  signedMessage: Uint8Array;
  signature: Uint8Array;
};

type PriceAlertEventRecord = {
  id: string;
  alertId: string;
  alertName: string;
  pair: string;
  direction: "above" | "below";
  targetPrice: number;
  currentPrice: number;
  triggeredAt: string;
};

type WalletAlertEventRecord = {
  id: string;
  alertId: string;
  alertName: string;
  walletAddress: string;
  watchKind: WalletWatchKind;
  previousBalanceLamports: number;
  currentBalanceLamports: number;
  deltaLamports: number;
  assetMint?: string;
  triggeredAt: string;
};

type TokenMetadata = {
  mint: string;
  name: string;
  symbol: string;
  decimals?: number;
  icon?: string;
};

const APP_NAME = "seeker alert";
const SOLANA_CHAIN = "solana:mainnet";
const SOLANA_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const walletUi = loadWalletUi();
const walletNativeEnabled = Boolean(walletUi && (NativeModules as Record<string, unknown>).SolanaMobileWalletAdapter);
const ALERT_NOTIFICATION_CHANNEL = "price-alerts-v2";
const localAlerts: RadarAlert[] = [];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export default function App() {
  if (!walletNativeEnabled || !walletUi) {
    return <RadarScreen nativeWalletEnabled={false} />;
  }

  const WalletProvider: any = walletUi.MobileWalletProvider;
  return (
    <WalletProvider
      chain={SOLANA_CHAIN}
      endpoint={SOLANA_RPC_ENDPOINT}
      identity={{ name: APP_NAME, uri: "https://seeker-alert.local" }}
    >
      <RadarScreen nativeWalletEnabled />
    </WalletProvider>
  );
}

function RadarScreen({ nativeWalletEnabled }: { nativeWalletEnabled: boolean }) {
  const wallet = useWalletBridge(nativeWalletEnabled);

  const [language, setLanguage] = useState<Lang>("en");
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [serverBaseUrl, setServerBaseUrl] = useState("https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/api");
  const [sessionToken, setSessionToken] = useState("");
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [alerts, setAlerts] = useState<RadarAlert[]>(localAlerts);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertRecord[]>([]);
  const [walletAlerts, setWalletAlerts] = useState<WalletAlertRecord[]>([]);
  const [priceAlertEvents, setPriceAlertEvents] = useState<PriceAlertEventRecord[]>([]);
  const [walletAlertEvents, setWalletAlertEvents] = useState<WalletAlertEventRecord[]>([]);
  const [radarStatus, setRadarStatus] = useState<RadarStatus | null>(null);
  const [createType, setCreateType] = useState<AlertType>("price");
  const [tokenMintInput, setTokenMintInput] = useState("");
  const [resolvedToken, setResolvedToken] = useState<TokenMetadata | null>(null);
  const [resolvingToken, setResolvingToken] = useState(false);
  const [priceDirection, setPriceDirection] = useState<PriceDirection>("above");
  const [priceThreshold, setPriceThreshold] = useState("200");
  const [walletWatchKind, setWalletWatchKind] = useState<WalletWatchKind>("receive_transfer");
  const [nftCollection, setNftCollection] = useState<NftCollection>("Mad Lads");
  const [nftDirection, setNftDirection] = useState<PriceDirection>("below");
  const [nftThreshold, setNftThreshold] = useState("55");
  const [lastTriggeredNotice, setLastTriggeredNotice] = useState("");
  const lastPriceAlertStatuses = useRef<Record<string, PriceAlertRecord["status"]>>({});
  const lastWalletAlertStatuses = useRef<Record<string, WalletAlertRecord["status"]>>({});
  const hasHydratedPriceAlerts = useRef(false);
  const hasHydratedWalletAlerts = useRef(false);
  const sessionTokenRef = useRef("");
  const loginPromiseRef = useRef<Promise<string> | null>(null);
  const alertSoundPlayer = useAudioPlayer(require("./assets/metal_gear_alert.wav"), { keepAudioSessionActive: true });
  const rawWalletAddress = wallet.account?.address?.toString?.();
  const walletConnected = Boolean(rawWalletAddress);
  const walletAddress = rawWalletAddress ?? pick(language, "Not connected", "未连接");
  const latestCheckedAtLabel = (() => {
    const latest = priceAlerts
      .map((item) => item.lastCheckedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return latest ? formatTimestamp(latest, language) : pick(language, "Waiting", "等待检查");
  })();
  const autoCheckLabel = (() => {
    const intervalMs = radarStatus?.priceAlertIntervalMs;

    if (!intervalMs || intervalMs <= 0) {
      return pick(language, "Not set", "未配置");
    }
    if (intervalMs < 60000) {
      return pick(language, `${Math.round(intervalMs / 1000)} sec`, `${Math.round(intervalMs / 1000)} 秒`);
    }

    return pick(language, `${Math.round(intervalMs / 60000)} min`, `${Math.round(intervalMs / 60000)} 分钟`);
  })();
  const convertRemotePriceAlert = (priceAlert: PriceAlertRecord): RadarAlert => ({
    id: priceAlert.id,
    name: priceAlert.name,
    type: "price",
    status: priceAlert.status,
    target: priceAlert.pair,
    condition: priceConditionLabel(priceAlert.direction, priceAlert.targetPrice, priceAlert.currentPrice, language),
    lastCheckedAt: formatTimestamp(priceAlert.lastCheckedAt, language),
    lastTriggeredAt: priceAlert.lastTriggeredAt ? formatTimestamp(priceAlert.lastTriggeredAt, language) : undefined
  });
  const convertRemoteWalletAlert = (walletAlert: WalletAlertRecord): RadarAlert => ({
    id: walletAlert.id,
    name: walletAlert.name,
    type: "wallet",
    status: walletAlert.status,
    target: walletAlert.walletAddress,
    condition: walletCondition(walletAlert.watchKind, language),
    lastCheckedAt: formatTimestamp(walletAlert.lastCheckedAt, language),
    lastTriggeredAt: walletAlert.lastTriggeredAt ? formatTimestamp(walletAlert.lastTriggeredAt, language) : undefined,
    walletWatchKind: walletAlert.watchKind
  });
  const mergedAlerts = [...priceAlerts.map(convertRemotePriceAlert), ...walletAlerts.map(convertRemoteWalletAlert), ...alerts];
  const activeCount = mergedAlerts.filter((item) => item.status === "active").length;
  const triggeredToday = mergedAlerts.filter((item) => item.status === "triggered").length;

  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false
    });
  }, []);

  useEffect(() => {
    void prepareNotifications();
  }, []);

  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      setRadarStatus(null);
      setPriceAlerts([]);
      setPriceAlertEvents([]);
      setWalletAlerts([]);
      setWalletAlertEvents([]);
      return;
    }

    void refreshPriceAlerts(false);
    void refreshPriceAlertEvents();
    void refreshWalletAlerts(false);
    void refreshWalletAlertEvents();
    void refreshRadarStatus();
  }, [serverBaseUrl, sessionToken]);

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    const timer = setInterval(() => {
      void checkPriceAlerts(false);
      void refreshPriceAlertEvents();
      void checkWalletAlerts(false);
      void refreshWalletAlertEvents();
    }, 5000);

    return () => clearInterval(timer);
  }, [serverBaseUrl, sessionToken]);

  useEffect(() => {
    if (createType !== "price") {
      return;
    }

    const nextMint = tokenMintInput.trim();
    if (!nextMint) {
      setResolvedToken(null);
      return;
    }

    try {
      new PublicKey(nextMint);
    } catch {
      setResolvedToken(null);
      return;
    }

    if (resolvedToken?.mint === nextMint) {
      return;
    }

    const timer = setTimeout(() => {
      void resolveTokenMetadata(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [createType, tokenMintInput, serverBaseUrl, resolvedToken?.mint]);

  function show(message: string) {
    Alert.alert(pick(language, "Notice", "提示"), message);
  }

  async function callApi(path: string, init?: RequestInit) {
    const token = await ensureSessionToken();

    const response = await fetch(`${serverBaseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      },
      ...init
    });

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      throw new Error(typeof data === "string" ? data : JSON.stringify(data));
    }

    return data;
  }

  async function resolveTokenMetadata(notify = true): Promise<TokenMetadata | null> {
    const nextMint = tokenMintInput.trim();
    if (!nextMint) {
      setResolvedToken(null);
      if (notify) {
        show(pick(language, "Enter a token CA first.", "请先输入代币合约地址"));
      }
      return null;
    }

    try {
      new PublicKey(nextMint);
    } catch {
      setResolvedToken(null);
      if (notify) {
        show(pick(language, "Invalid Solana token CA.", "无效的 Solana 代币合约地址"));
      }
      return null;
    }

    setResolvingToken(true);
    try {
      const response = await fetch(`${serverBaseUrl}/api/token-meta?mint=${encodeURIComponent(nextMint)}`);
      const data = (await response.json()) as TokenMetadata | { error?: string };
      if (!response.ok || !("mint" in data)) {
        throw new Error(typeof data === "object" && data && "error" in data && data.error ? data.error : "token metadata not found");
      }
      setResolvedToken(data);
      if (notify) {
        show(
          pick(
            language,
            `Tracking ${data.name} (${data.symbol}).`,
            `已识别代币 ${data.name}（${data.symbol}）`
          )
        );
      }
      return data;
    } catch (error) {
      setResolvedToken(null);
      if (notify) {
        show(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      setResolvingToken(false);
    }
  }

  async function onConnectWallet() {
    if (!nativeWalletEnabled) {
      show(pick(language, "Expo Go cannot use the native wallet. Open the installed Dev Client.", "当前运行的是 Expo Go，不支持原生钱包连接。请打开已安装的 Dev Client。"));
      return;
    }

    try {
      const connectedAccount = await wallet.connect();
      await loginWithWallet(connectedAccount.address.toString());
      await refreshPriceAlerts(false);
      await refreshPriceAlertEvents();
      await refreshWalletAlerts(false);
      await refreshWalletAlertEvents();
      await refreshRadarStatus();
      show(pick(language, "Wallet connected and signed in.", "钱包已连接并登录"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function onDisconnectWallet() {
    if (!nativeWalletEnabled) {
      show(pick(language, "Expo Go cannot use the native wallet. Open the installed Dev Client.", "当前运行的是 Expo Go，不支持原生钱包连接。请打开已安装的 Dev Client。"));
      return;
    }

    try {
      await wallet.disconnect();
      setSessionToken("");
      show(pick(language, "Wallet disconnected.", "钱包已断开"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  function onCreateAlert() {
    if (creatingAlert) {
      return;
    }

    if (createType === "price") {
      const threshold = Number(priceThreshold);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        show(pick(language, "Enter a valid target price.", "请输入有效的价格数字"));
        return;
      }

      const tokenMeta = resolvedToken?.mint === tokenMintInput.trim() ? resolvedToken : undefined;
      const createWithToken = async () => {
        const resolved = tokenMeta ?? (await resolveTokenMetadata(false));
        if (!resolved) {
          return;
        }

        void createPriceAlert(
          priceAlertName(resolved.symbol, priceDirection, threshold, language),
          `${resolved.symbol} / USDC`,
          resolved.mint,
          USDC_MINT,
          priceDirection,
          threshold
        );
      };

      void createWithToken();
      return;
    }

    if (createType === "wallet") {
      if (!rawWalletAddress) {
        show(pick(language, "Connect your wallet first.", "请先连接钱包"));
        return;
      }

      void createWalletAlert(rawWalletAddress, walletWatchKind);
      return;
    }

    const nextAlert = buildLocalAlert(
      createType,
      walletWatchKind,
      nftCollection,
      nftDirection,
      nftThreshold,
      rawWalletAddress,
      language
    );
    if (!nextAlert) {
      show(pick(language, "Enter a valid number.", "请输入有效的数字"));
      return;
    }

    setAlerts((current) => [nextAlert, ...current]);
    setActiveTab("alerts");
    show(pick(language, "Alert created.", "提醒已创建"));
  }

  async function createPriceAlert(
    name: string,
    pair: string,
    inputMint: string,
    outputMint: string,
    direction: PriceDirection,
    targetPrice: number
  ) {
    setCreatingAlert(true);
    try {
      await callApi("/api/radar/price-alerts", {
        method: "POST",
        body: JSON.stringify({
          name,
          pair,
          inputMint,
          outputMint,
          direction,
          targetPrice
        })
      });
      await refreshPriceAlerts(false);
      setActiveTab("alerts");
      show(pick(language, "Price alert created and synced.", "价格提醒已创建，并同步到后端"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingAlert(false);
    }
  }

  async function createWalletAlert(nextWalletAddress: string, watchKind: WalletWatchKind) {
    setCreatingAlert(true);
    try {
      await callApi("/api/radar/wallet-alerts", {
        method: "POST",
        body: JSON.stringify({
          name: walletAlertName(watchKind, language),
          walletAddress: nextWalletAddress,
          watchKind
        })
      });
      await refreshWalletAlerts(false);
      setActiveTab("alerts");
      show(pick(language, "Wallet alert created and synced.", "钱包提醒已创建，并同步到后端"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingAlert(false);
    }
  }

  async function refreshPriceAlerts(notify = true) {
    try {
      const data = (await callApi("/api/radar/price-alerts")) as PriceAlertRecord[];
      maybeNotifyTriggeredAlerts(data);
      setPriceAlerts(data);
      if (notify) {
        show(
          data.length === 0
            ? pick(language, "No price alerts on the server yet.", "后端里还没有价格提醒")
            : pick(language, `Refreshed ${data.length} price alerts.`, `已刷新 ${data.length} 条价格提醒`)
        );
      }
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshWalletAlerts(notify = true) {
    try {
      const data = (await callApi("/api/radar/wallet-alerts")) as WalletAlertRecord[];
      maybeNotifyTriggeredWalletAlerts(data);
      setWalletAlerts(data);
      if (notify) {
        show(
          data.length === 0
            ? pick(language, "No wallet alerts on the server yet.", "后端里还没有钱包提醒")
            : pick(language, `Refreshed ${data.length} wallet alerts.`, `已刷新 ${data.length} 条钱包提醒`)
        );
      }
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshRadarStatus() {
    try {
      const data = (await callApi("/api/radar/status")) as RadarStatus;
      setRadarStatus(data);
    } catch {
      setRadarStatus(null);
    }
  }

  async function refreshPriceAlertEvents() {
    try {
      const data = (await callApi("/api/radar/price-alert-events")) as PriceAlertEventRecord[];
      setPriceAlertEvents(data);
    } catch {
      setPriceAlertEvents([]);
    }
  }

  async function refreshWalletAlertEvents() {
    try {
      const data = (await callApi("/api/radar/wallet-alert-events")) as WalletAlertEventRecord[];
      setWalletAlertEvents(data);
    } catch {
      setWalletAlertEvents([]);
    }
  }

  async function testAlertNotification() {
    try {
      void alertSoundPlayer.seekTo(0).catch(() => undefined);
      alertSoundPlayer.play();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: pick(language, `${APP_NAME} test alert`, `${APP_NAME} 测试提醒`),
          body: pick(language, "This is a test notification for sound and system alerts.", "这是一条测试通知，用来确认声音和系统通知是否正常。"),
          sound: "metal_gear_alert.wav"
        },
        trigger: {
          type: "channel",
          channelId: ALERT_NOTIFICATION_CHANNEL
        } as unknown as Notifications.NotificationTriggerInput
      });
      show(pick(language, "Test notification sent.", "测试通知已发送"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  function maybeNotifyTriggeredAlerts(nextAlerts: PriceAlertRecord[]) {
    const currentStatuses = Object.fromEntries(nextAlerts.map((item) => [item.id, item.status])) as Record<
      string,
      PriceAlertRecord["status"]
    >;

    if (!hasHydratedPriceAlerts.current) {
      lastPriceAlertStatuses.current = currentStatuses;
      hasHydratedPriceAlerts.current = true;
      return;
    }

    const newlyTriggered = nextAlerts.filter((item) => {
      const previous = lastPriceAlertStatuses.current[item.id];
      return previous !== "triggered" && item.status === "triggered";
    });

    lastPriceAlertStatuses.current = currentStatuses;
    if (newlyTriggered.length === 0) {
      return;
    }

    const first = newlyTriggered[0];
    const message =
      newlyTriggered.length === 1
        ? pick(language, `${first.name} triggered.`, `${first.name} 已命中`)
        : pick(language, `${first.name} and ${newlyTriggered.length - 1} more alerts triggered.`, `${first.name} 等 ${newlyTriggered.length} 条提醒已命中`);

    void alertSoundPlayer.seekTo(0).catch(() => undefined);
    alertSoundPlayer.play();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: pick(language, `${APP_NAME} price alert`, `${APP_NAME} 提醒命中`),
        body: message,
        sound: "metal_gear_alert.wav"
      },
      trigger: {
        type: "channel",
        channelId: ALERT_NOTIFICATION_CHANNEL
      } as unknown as Notifications.NotificationTriggerInput
    });

    if (message !== lastTriggeredNotice) {
      setLastTriggeredNotice(message);
      Alert.alert(pick(language, "Alert triggered", "提醒命中"), message);
    }
  }

  function maybeNotifyTriggeredWalletAlerts(nextAlerts: WalletAlertRecord[]) {
    const currentStatuses = Object.fromEntries(nextAlerts.map((item) => [item.id, item.status])) as Record<
      string,
      WalletAlertRecord["status"]
    >;

    if (!hasHydratedWalletAlerts.current) {
      lastWalletAlertStatuses.current = currentStatuses;
      hasHydratedWalletAlerts.current = true;
      return;
    }

    const newlyTriggered = nextAlerts.filter((item) => {
      const previous = lastWalletAlertStatuses.current[item.id];
      return previous !== "triggered" && item.status === "triggered";
    });

    lastWalletAlertStatuses.current = currentStatuses;
    if (newlyTriggered.length === 0) {
      return;
    }

    const first = newlyTriggered[0];
    const message = pick(language, `${first.name} triggered.`, `${first.name} 已命中`);
    void alertSoundPlayer.seekTo(0).catch(() => undefined);
    alertSoundPlayer.play();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: pick(language, `${APP_NAME} wallet alert`, `${APP_NAME} 钱包异动`),
        body: message,
        sound: "metal_gear_alert.wav"
      },
      trigger: {
        type: "channel",
        channelId: ALERT_NOTIFICATION_CHANNEL
      } as unknown as Notifications.NotificationTriggerInput
    });
  }

  async function checkPriceAlerts(notify = true) {
    try {
      const result = (await callApi("/api/radar/price-alerts/check", { method: "POST" })) as {
        alerts: PriceAlertRecord[];
      };
      maybeNotifyTriggeredAlerts(result.alerts);
      setPriceAlerts(result.alerts);
      if (notify) {
        show(pick(language, "Price alerts checked.", "价格提醒已检查"));
      }
    } catch (error) {
      if (notify) {
        show(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function checkWalletAlerts(notify = true) {
    try {
      const result = (await callApi("/api/radar/wallet-alerts/check", { method: "POST" })) as {
        alerts: WalletAlertRecord[];
      };
      maybeNotifyTriggeredWalletAlerts(result.alerts);
      setWalletAlerts(result.alerts);
      if (notify) {
        show(pick(language, "Wallet alerts checked.", "钱包提醒已检查"));
      }
    } catch (error) {
      if (notify) {
        show(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function toggleRemotePriceAlert(id: string, status: PriceAlertRecord["status"]) {
    try {
      const nextStatus = status === "paused" ? "active" : "paused";
      await callApi(`/api/radar/price-alerts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      await refreshPriceAlerts(false);
      show(nextStatus === "paused" ? pick(language, "Price alert paused.", "价格提醒已暂停") : pick(language, "Price alert resumed.", "价格提醒已恢复"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRemotePriceAlert(id: string) {
    try {
      await callApi(`/api/radar/price-alerts/${id}`, {
        method: "DELETE"
      });
      setPriceAlerts((current) => current.filter((item) => item.id !== id));
      show(pick(language, "Price alert deleted.", "价格提醒已删除"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleRemoteWalletAlert(id: string, status: WalletAlertRecord["status"]) {
    try {
      const nextStatus = status === "paused" ? "active" : "paused";
      await callApi(`/api/radar/wallet-alerts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      await refreshWalletAlerts(false);
      show(nextStatus === "paused" ? pick(language, "Wallet alert paused.", "钱包提醒已暂停") : pick(language, "Wallet alert resumed.", "钱包提醒已恢复"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRemoteWalletAlert(id: string) {
    try {
      await callApi(`/api/radar/wallet-alerts/${id}`, {
        method: "DELETE"
      });
      setWalletAlerts((current) => current.filter((item) => item.id !== id));
      show(pick(language, "Wallet alert deleted.", "钱包提醒已删除"));
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function loginWithWallet(nextWalletAddress?: string) {
    const resolvedWalletAddress = nextWalletAddress ?? wallet.account?.address?.toString?.();
    if (!resolvedWalletAddress) {
      throw new Error(pick(language, "Wallet address is unavailable.", "钱包还没有返回地址"));
    }

    const nonceRes = (await fetch(
      `${serverBaseUrl}/api/auth/nonce?wallet=${encodeURIComponent(resolvedWalletAddress)}`
    ).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      }
      return data as { nonce: string };
    })) as { nonce: string };

    const signInResult = await wallet.signIn({
      domain: extractDomain(serverBaseUrl),
      statement: `Sign in to ${APP_NAME}`,
      uri: serverBaseUrl,
      version: "1",
      chainId: SOLANA_CHAIN,
      nonce: nonceRes.nonce
    });

    const verifyRes = await fetch(`${serverBaseUrl}/api/auth/verify-signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        wallet: resolvedWalletAddress,
        nonce: nonceRes.nonce,
        signedMessageEncoded: decodeEncodedText(signInResult.signedMessage),
        signatureEncoded: decodeEncodedText(signInResult.signature)
      })
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data === "string" ? data : JSON.stringify(data));
      }
      return data as { token: string };
    });

    setSessionToken(verifyRes.token);
    sessionTokenRef.current = verifyRes.token;
    return verifyRes.token;
  }

  async function ensureSessionToken(): Promise<string> {
    if (sessionTokenRef.current) {
      return sessionTokenRef.current;
    }

    const nextWalletAddress = wallet.account?.address?.toString?.();
    if (!nextWalletAddress) {
      throw new Error(pick(language, "Connect your wallet and sign in first.", "请先连接钱包并完成登录"));
    }

    if (!loginPromiseRef.current) {
      loginPromiseRef.current = loginWithWallet(nextWalletAddress).finally(() => {
        loginPromiseRef.current = null;
      });
    }

    return loginPromiseRef.current;
  }

  function onToggleStatus(id: string) {
    setAlerts((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }

        return {
          ...item,
          status: item.status === "paused" ? "active" : "paused"
        };
      })
    );
  }

  function onDeleteAlert(id: string) {
    setAlerts((current) => current.filter((item) => item.id !== id));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.appShell}>
        <View style={styles.header}>
          <View style={styles.rowBetweenTop}>
            <View style={styles.headerCopy}>
              <Text style={styles.brand}>{APP_NAME}</Text>
              <Text style={styles.headerSub}>{pick(language, "Mobile on-chain alert center", "移动端链上提醒中心")}</Text>
            </View>
            <View style={styles.languageToggle}>
              <LanguageButton active={language === "zh"} label="中文" onPress={() => setLanguage("zh")} />
              <LanguageButton active={language === "en"} label="English" onPress={() => setLanguage("en")} />
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {activeTab === "home" ? (
            <HomeTab
              lang={language}
              activeCount={activeCount}
              alerts={mergedAlerts}
              autoCheckLabel={autoCheckLabel}
              latestCheckedAt={latestCheckedAtLabel}
              recentEvents={priceAlertEvents}
              recentWalletEvents={walletAlertEvents}
              triggeredToday={triggeredToday}
              walletAddress={walletAddress}
              onCheckPriceAlerts={checkPriceAlerts}
              onQuickCreate={(type) => {
                setCreateType(type);
                if (type === "wallet") {
                  setWalletWatchKind("receive_transfer");
                }
                setActiveTab("create");
              }}
            />
          ) : null}

          {activeTab === "alerts" ? (
            <AlertsTab
              lang={language}
              alerts={mergedAlerts}
              autoCheckLabel={autoCheckLabel}
              onCheckPriceAlerts={checkPriceAlerts}
              onCheckWalletAlerts={checkWalletAlerts}
              onDeleteAlert={onDeleteAlert}
              onDeletePriceAlert={deleteRemotePriceAlert}
              onDeleteWalletAlert={deleteRemoteWalletAlert}
              onRefreshPriceAlertEvents={refreshPriceAlertEvents}
              onRefreshPriceAlerts={refreshPriceAlerts}
              onRefreshWalletAlertEvents={refreshWalletAlertEvents}
              onRefreshWalletAlerts={refreshWalletAlerts}
              priceAlertEvents={priceAlertEvents}
              walletAlertEvents={walletAlertEvents}
              onToggleStatus={onToggleStatus}
              onTogglePriceAlert={toggleRemotePriceAlert}
              onToggleWalletAlert={toggleRemoteWalletAlert}
            />
          ) : null}

          {activeTab === "create" ? (
            <CreateTab
              lang={language}
              createType={createType}
              nftCollection={nftCollection}
              nftDirection={nftDirection}
              nftThreshold={nftThreshold}
              priceDirection={priceDirection}
              priceThreshold={priceThreshold}
              tokenMintInput={tokenMintInput}
              resolvedToken={resolvedToken}
              resolvingToken={resolvingToken}
              walletAddress={walletAddress}
              walletWatchKind={walletWatchKind}
              onCreateAlert={onCreateAlert}
              creatingAlert={creatingAlert}
              onSetCreateType={setCreateType}
              onSetNftCollection={setNftCollection}
              onSetNftDirection={setNftDirection}
              onSetNftThreshold={setNftThreshold}
              onSetPriceDirection={setPriceDirection}
              onSetPriceThreshold={setPriceThreshold}
              onSetTokenMintInput={(value) => {
                setTokenMintInput(value);
                setResolvedToken(null);
              }}
              onSetWalletWatchKind={setWalletWatchKind}
            />
          ) : null}

          {activeTab === "me" ? (
            <MeTab
              lang={language}
              nativeWalletEnabled={nativeWalletEnabled}
              onTestAlertNotification={testAlertNotification}
              walletAddress={walletAddress}
              walletConnected={walletConnected}
              onConnectWallet={onConnectWallet}
              onDisconnectWallet={onDisconnectWallet}
            />
          ) : null}
        </ScrollView>

        <View style={styles.tabBar}>
          <TabButton active={activeTab === "home"} label={pick(language, "Home", "首页")} onPress={() => setActiveTab("home")} />
          <TabButton active={activeTab === "alerts"} label={pick(language, "Alerts", "提醒")} onPress={() => setActiveTab("alerts")} />
          <TabButton active={activeTab === "create"} label={pick(language, "Create", "创建")} onPress={() => setActiveTab("create")} />
          <TabButton active={activeTab === "me"} label={pick(language, "Me", "我的")} onPress={() => setActiveTab("me")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function HomeTab({
  lang,
  activeCount,
  alerts,
  autoCheckLabel,
  latestCheckedAt,
  onCheckPriceAlerts,
  recentEvents,
  recentWalletEvents,
  triggeredToday,
  walletAddress,
  onQuickCreate
}: {
  lang: Lang;
  activeCount: number;
  alerts: RadarAlert[];
  autoCheckLabel: string;
  latestCheckedAt: string;
  onCheckPriceAlerts: () => Promise<void>;
  recentEvents: PriceAlertEventRecord[];
  recentWalletEvents: WalletAlertEventRecord[];
  triggeredToday: number;
  walletAddress: string;
  onQuickCreate: (type: AlertType) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEyebrow}>{pick(lang, "Today", "今日状态")}</Text>
        <Text style={styles.heroTitle}>{pick(lang, "Price and wallet alerts in one place.", "钱包动态和价格提醒都集中在这里。")}</Text>
        <Text style={styles.heroMeta}>{pick(lang, "Wallet", "钱包")}：{walletAddress}</Text>
      </View>

      <View style={styles.metricsRow}>
        <MetricCard lang={lang} label={pick(lang, "Active alerts", "运行中提醒")} value={String(activeCount)} tone="blue" />
        <MetricCard lang={lang} label={pick(lang, "Triggered today", "今日命中")} value={String(triggeredToday)} tone="green" />
        <MetricCard lang={lang} label={pick(lang, "Last check", "最近检查")} value={latestCheckedAt} tone="orange" />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Quick create", "快捷创建")}</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => onQuickCreate("price")}>
            <Text style={styles.buttonText}>{pick(lang, "Price", "价格提醒")}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => onQuickCreate("wallet")}>
            <Text style={styles.buttonText}>{pick(lang, "Wallet", "钱包异动")}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => onQuickCreate("nft")}>
            <Text style={styles.buttonText}>{pick(lang, "NFT", "NFT 动态")}</Text>
          </Pressable>
        </View>
        <Text style={styles.supportText}>{pick(lang, `Price alerts are checked by the backend automatically: ${autoCheckLabel}.`, `价格提醒由后端自动检查，当前频率：${autoCheckLabel}`)}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void onCheckPriceAlerts()}>
          <Text style={styles.secondaryButtonText}>{pick(lang, "Run price check now", "手动检查价格提醒")}</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Recent alerts", "最近提醒")}</Text>
        {alerts.slice(0, 3).map((item) => (
          <View key={item.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{item.name}</Text>
              <Text style={styles.alertMeta}>
                {formatType(item.type, lang)} | {item.condition}
              </Text>
            </View>
            <StatusBadge lang={lang} status={item.status} />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Recent price triggers", "最近命中记录")}</Text>
        {recentEvents.length === 0 ? <Text style={styles.supportText}>{pick(lang, "No price trigger history yet.", "还没有价格提醒命中记录。")}</Text> : null}
        {recentEvents.slice(0, 3).map((event) => (
          <View key={event.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{event.alertName}</Text>
              <Text style={styles.alertMeta}>
                {event.pair} | {pick(lang, "Current", "当前")} {event.currentPrice.toFixed(4)} | {formatTimestamp(event.triggeredAt, lang)}
              </Text>
            </View>
            <StatusBadge lang={lang} status="triggered" />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Recent wallet activity", "最近钱包异动")}</Text>
        {recentWalletEvents.length === 0 ? <Text style={styles.supportText}>{pick(lang, "No wallet activity yet.", "还没有钱包异动记录。")}</Text> : null}
        {recentWalletEvents.slice(0, 3).map((event) => (
          <View key={event.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{event.alertName}</Text>
              <Text style={styles.alertMeta}>
                {formatWalletEvent(event, lang)} | {formatTimestamp(event.triggeredAt, lang)}
              </Text>
            </View>
            <StatusBadge lang={lang} status="triggered" />
          </View>
        ))}
      </View>
    </View>
  );
}

function AlertsTab({
  lang,
  alerts,
  autoCheckLabel,
  onCheckPriceAlerts,
  onCheckWalletAlerts,
  onDeleteAlert,
  onDeletePriceAlert,
  onDeleteWalletAlert,
  onRefreshPriceAlertEvents,
  onRefreshPriceAlerts,
  onRefreshWalletAlertEvents,
  onRefreshWalletAlerts,
  priceAlertEvents,
  walletAlertEvents,
  onToggleStatus,
  onTogglePriceAlert,
  onToggleWalletAlert
}: {
  lang: Lang;
  alerts: RadarAlert[];
  autoCheckLabel: string;
  onCheckPriceAlerts: () => Promise<void>;
  onCheckWalletAlerts: () => Promise<void>;
  onDeleteAlert: (id: string) => void;
  onDeletePriceAlert: (id: string) => Promise<void>;
  onDeleteWalletAlert: (id: string) => Promise<void>;
  onRefreshPriceAlertEvents: () => Promise<void>;
  onRefreshPriceAlerts: () => Promise<void>;
  onRefreshWalletAlertEvents: () => Promise<void>;
  onRefreshWalletAlerts: () => Promise<void>;
  priceAlertEvents: PriceAlertEventRecord[];
  walletAlertEvents: WalletAlertEventRecord[];
  onToggleStatus: (id: string) => void;
  onTogglePriceAlert: (id: string, status: AlertStatus) => Promise<void>;
  onToggleWalletAlert: (id: string, status: AlertStatus) => Promise<void>;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "My alerts", "我的提醒")}</Text>
        <Text style={styles.supportText}>{pick(lang, `Price alerts are monitored by the backend. Current interval: ${autoCheckLabel}.`, `价格提醒由后端监控，当前自动检查频率：${autoCheckLabel}。`)}</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => void onRefreshPriceAlerts()}>
            <Text style={styles.buttonText}>{pick(lang, "Refresh price alerts", "刷新价格提醒")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onCheckPriceAlerts()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Check price alerts", "检查价格提醒")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshPriceAlertEvents()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Refresh price history", "刷新命中历史")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshWalletAlerts()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Refresh wallet alerts", "刷新钱包提醒")}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onCheckWalletAlerts()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Check wallet alerts", "检查钱包提醒")}</Text>
          </Pressable>
        </View>
      </View>

      {alerts.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{item.name}</Text>
              <Text style={styles.alertMeta}>{formatType(item.type, lang)}</Text>
            </View>
            <StatusBadge lang={lang} status={item.status} />
          </View>
          <Text style={styles.detailText}>{pick(lang, "Target", "监控对象")}：{item.target}</Text>
          <Text style={styles.detailText}>{pick(lang, "Condition", "触发条件")}：{item.condition}</Text>
          <Text style={styles.detailText}>{pick(lang, "Last checked", "最后检查")}：{item.lastCheckedAt}</Text>
          <Text style={styles.detailText}>{pick(lang, "Last triggered", "最近触发")}：{item.lastTriggeredAt ?? pick(lang, "N/A", "暂无")}</Text>
          {item.type === "price" ? (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void onTogglePriceAlert(item.id, item.status)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? pick(lang, "Resume", "恢复") : pick(lang, "Pause", "暂停")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void onDeletePriceAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>{pick(lang, "Delete", "删除")}</Text>
              </Pressable>
            </View>
          ) : item.type === "wallet" ? (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void onToggleWalletAlert(item.id, item.status)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? pick(lang, "Resume", "恢复") : pick(lang, "Pause", "暂停")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void onDeleteWalletAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>{pick(lang, "Delete", "删除")}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => onToggleStatus(item.id)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? pick(lang, "Resume", "恢复") : pick(lang, "Pause", "暂停")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => onDeleteAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>{pick(lang, "Delete", "删除")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {alerts.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{pick(lang, "No alerts yet", "还没有提醒")}</Text>
          <Text style={styles.supportText}>{pick(lang, "Create a price, wallet, or NFT alert first, then come back here to refresh.", "先去“创建”页面新建一条价格、钱包或 NFT 提醒，再回到这里刷新查看。")}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Price trigger history", "命中历史")}</Text>
        {priceAlertEvents.length === 0 ? <Text style={styles.supportText}>{pick(lang, "No history yet.", "还没有历史记录。")}</Text> : null}
        {priceAlertEvents.slice(0, 8).map((event) => (
          <View key={event.id} style={styles.historyItem}>
            <Text style={styles.alertName}>{event.alertName}</Text>
            <Text style={styles.alertMeta}>
              {event.pair} | {pick(lang, "Target", "目标")} {event.targetPrice} | {pick(lang, "Current", "当前")} {event.currentPrice.toFixed(4)}
            </Text>
            <Text style={styles.supportText}>{formatTimestamp(event.triggeredAt, lang)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Wallet activity history", "钱包异动历史")}</Text>
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshWalletAlertEvents()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Refresh wallet history", "刷新钱包历史")}</Text>
          </Pressable>
        </View>
        {walletAlertEvents.length === 0 ? <Text style={styles.supportText}>{pick(lang, "No wallet activity history yet.", "还没有钱包异动历史。")}</Text> : null}
        {walletAlertEvents.slice(0, 8).map((event) => (
          <View key={event.id} style={styles.historyItem}>
            <Text style={styles.alertName}>{event.alertName}</Text>
            <Text style={styles.alertMeta}>{formatWalletEvent(event, lang)}</Text>
            <Text style={styles.supportText}>{formatTimestamp(event.triggeredAt, lang)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CreateTab({
  lang,
  createType,
  creatingAlert,
  nftCollection,
  nftDirection,
  nftThreshold,
  priceDirection,
  priceThreshold,
  tokenMintInput,
  resolvedToken,
  resolvingToken,
  walletAddress,
  walletWatchKind,
  onCreateAlert,
  onSetCreateType,
  onSetNftCollection,
  onSetNftDirection,
  onSetNftThreshold,
  onSetPriceDirection,
  onSetPriceThreshold,
  onSetTokenMintInput,
  onSetWalletWatchKind
}: {
  lang: Lang;
  createType: AlertType;
  creatingAlert: boolean;
  nftCollection: NftCollection;
  nftDirection: PriceDirection;
  nftThreshold: string;
  priceDirection: PriceDirection;
  priceThreshold: string;
  tokenMintInput: string;
  resolvedToken: TokenMetadata | null;
  resolvingToken: boolean;
  walletAddress: string;
  walletWatchKind: WalletWatchKind;
  onCreateAlert: () => void;
  onSetCreateType: (value: AlertType) => void;
  onSetNftCollection: (value: NftCollection) => void;
  onSetNftDirection: (value: PriceDirection) => void;
  onSetNftThreshold: (value: string) => void;
  onSetPriceDirection: (value: PriceDirection) => void;
  onSetPriceThreshold: (value: string) => void;
  onSetTokenMintInput: (value: string) => void;
  onSetWalletWatchKind: (value: WalletWatchKind) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Create alert", "创建提醒")}</Text>
        <Text style={styles.supportText}>{pick(lang, "Keep the first version structured and simple, then expand later.", "先把提醒做成结构化 MVP，后面再扩展。")}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{pick(lang, "Alert type", "提醒类型")}</Text>
        <View style={styles.row}>
          <Pill active={createType === "price"} label={pick(lang, "Price", "价格")} onPress={() => onSetCreateType("price")} />
          <Pill active={createType === "wallet"} label={pick(lang, "Wallet", "钱包")} onPress={() => onSetCreateType("wallet")} />
          <Pill active={createType === "nft"} label="NFT" onPress={() => onSetCreateType("nft")} />
        </View>

        {createType === "price" ? (
          <>
            <Text style={styles.label}>{pick(lang, "Token CA", "代币合约地址")}</Text>
            <Text style={styles.supportText}>{pick(lang, "Paste a Solana token CA. The app will resolve the token name and track it against USDC.", "输入 Solana 代币合约地址，App 会解析代币名称，并按该代币对 USDC 的价格进行提醒。")}</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onSetTokenMintInput}
              placeholder={pick(lang, "Paste token CA", "粘贴代币合约地址")}
              placeholderTextColor="#6f8195"
              style={styles.input}
              value={tokenMintInput}
            />
            {resolvingToken ? <Text style={styles.supportText}>{pick(lang, "Resolving token...", "正在识别代币...")}</Text> : null}
            {resolvedToken ? (
              <View style={styles.previewCard}>
                <Text style={styles.label}>{pick(lang, "Resolved token", "识别结果")}</Text>
                <Text style={styles.alertName}>{resolvedToken.name}</Text>
                <Text style={styles.detailText}>{pick(lang, "Symbol", "符号")}：{resolvedToken.symbol}</Text>
                <Text style={styles.detailText}>{pick(lang, "Tracking pair", "追踪交易对")}：{resolvedToken.symbol} / USDC</Text>
              </View>
            ) : null}

            <Text style={styles.label}>{pick(lang, "Direction", "触发方向")}</Text>
            <View style={styles.row}>
              <Pill active={priceDirection === "above"} label={pick(lang, "Price above", "价格高于")} onPress={() => onSetPriceDirection("above")} />
              <Pill active={priceDirection === "below"} label={pick(lang, "Price below", "价格低于")} onPress={() => onSetPriceDirection("below")} />
            </View>

            <Text style={styles.label}>{pick(lang, "Target price", "目标价格")}</Text>
            <Text style={styles.supportText}>{pick(lang, "Only enter the number. The rule text is generated automatically.", "这里只输入数字，条件文案会自动生成。")}</Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={onSetPriceThreshold}
              placeholder={pick(lang, "For example 200", "例如 200")}
              placeholderTextColor="#6f8195"
              style={styles.input}
              value={priceThreshold}
            />
          </>
        ) : null}

        {createType === "wallet" ? (
          <>
            <Text style={styles.label}>{pick(lang, "Target wallet", "监控对象")}</Text>
            <Text style={styles.detailText}>{walletAddress}</Text>
            <Text style={styles.supportText}>{pick(lang, "Wallet alerts always watch the currently connected wallet.", "钱包提醒固定监控当前连接的钱包地址。")}</Text>

            <Text style={styles.label}>{pick(lang, "Watch for", "重点监控什么异动")}</Text>
            <View style={styles.row}>
              <Pill active={walletWatchKind === "receive_transfer"} label={pick(lang, "Incoming transfer", "收到转账")} onPress={() => onSetWalletWatchKind("receive_transfer")} />
              <Pill active={walletWatchKind === "send_transfer"} label={pick(lang, "Outgoing transfer", "转出资产")} onPress={() => onSetWalletWatchKind("send_transfer")} />
              <Pill active={walletWatchKind === "new_token"} label={pick(lang, "New token", "新代币")} onPress={() => onSetWalletWatchKind("new_token")} />
              <Pill active={walletWatchKind === "receive_nft"} label={pick(lang, "Receive NFT", "收到 NFT")} onPress={() => onSetWalletWatchKind("receive_nft")} />
            </View>
            <Text style={styles.supportText}>{pick(lang, "Wallet alerts use the backend watcher for SOL balance changes, new tokens, and NFTs.", "钱包提醒现在走后端真实监听：SOL 余额变化、新代币出现、收到 NFT。")}</Text>
            <Text style={styles.supportText}>{walletWatchDescription(walletWatchKind, lang)}</Text>
          </>
        ) : null}

        {createType === "nft" ? (
          <>
            <Text style={styles.label}>Collection</Text>
            <View style={styles.row}>
              <Pill active={nftCollection === "Mad Lads"} label="Mad Lads" onPress={() => onSetNftCollection("Mad Lads")} />
              <Pill active={nftCollection === "Claynosaurz"} label="Claynosaurz" onPress={() => onSetNftCollection("Claynosaurz")} />
              <Pill active={nftCollection === "Okay Bears"} label="Okay Bears" onPress={() => onSetNftCollection("Okay Bears")} />
            </View>

            <Text style={styles.label}>{pick(lang, "Direction", "触发方向")}</Text>
            <View style={styles.row}>
              <Pill active={nftDirection === "above"} label={pick(lang, "Floor above", "地板价高于")} onPress={() => onSetNftDirection("above")} />
              <Pill active={nftDirection === "below"} label={pick(lang, "Floor below", "地板价低于")} onPress={() => onSetNftDirection("below")} />
            </View>

            <Text style={styles.label}>{pick(lang, "Target floor", "目标价格")}</Text>
            <Text style={styles.supportText}>{pick(lang, "Only enter the number. The NFT rule text is generated automatically.", "这里只输入数字，NFT 提醒名称和条件会自动生成。")}</Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={onSetNftThreshold}
              placeholder={pick(lang, "For example 55", "例如 55")}
              placeholderTextColor="#6f8195"
              style={styles.input}
              value={nftThreshold}
            />
          </>
        ) : null}

        <View style={styles.previewCard}>
          <Text style={styles.label}>{pick(lang, "Preview", "将要创建的提醒")}</Text>
          <Text style={styles.alertName}>
            {previewAlertName(
              lang,
              createType,
              resolvedToken?.symbol,
              priceDirection,
              priceThreshold,
              walletWatchKind,
              nftCollection,
              nftDirection,
              nftThreshold
            )}
          </Text>
          <Text style={styles.detailText}>
            {pick(lang, "Target", "监控对象")}：{previewTarget(lang, createType, resolvedToken?.symbol, nftCollection, walletAddress)}
          </Text>
          <Text style={styles.detailText}>{pick(lang, "Condition", "触发条件")}：{previewCondition(lang, createType, priceDirection, priceThreshold, walletWatchKind, nftDirection, nftThreshold)}</Text>
        </View>

        <Pressable style={styles.primaryCta} onPress={onCreateAlert}>
          <Text style={styles.primaryCtaText}>{creatingAlert ? pick(lang, "Creating...", "创建中...") : pick(lang, "Create alert", "创建提醒")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MeTab({
  lang,
  nativeWalletEnabled,
  onTestAlertNotification,
  walletAddress,
  walletConnected,
  onConnectWallet,
  onDisconnectWallet
}: {
  lang: Lang;
  nativeWalletEnabled: boolean;
  onTestAlertNotification: () => Promise<void>;
  walletAddress: string;
  walletConnected: boolean;
  onConnectWallet: () => Promise<void>;
  onDisconnectWallet: () => Promise<void>;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Wallet", "钱包")}</Text>
        <Text style={styles.detailText}>{pick(lang, "Current address", "当前地址")}：{walletAddress}</Text>
        <Text style={styles.supportText}>
          {nativeWalletEnabled
            ? pick(lang, "Use the installed Seeker Dev Client to connect the wallet.", "使用已安装的 Seeker Dev Client 连接钱包。")
            : pick(lang, "Running in Expo Go. You can only preview the UI.", "当前是 Expo Go，仅能预览界面。")}
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={walletConnected ? onDisconnectWallet : onConnectWallet}>
            <Text style={styles.buttonText}>{walletConnected ? pick(lang, "Disconnect", "断开连接") : pick(lang, "Connect wallet", "连接钱包")}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{pick(lang, "Notifications", "通知")}</Text>
        <Text style={styles.supportText}>{pick(lang, "Use the test button below to confirm sound and system notifications are working.", "用下面的测试按钮确认声音和系统通知是否正常。")}</Text>
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={() => void onTestAlertNotification()}>
            <Text style={styles.secondaryButtonText}>{pick(lang, "Test alert sound", "测试通知声音")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MetricCard({ label, tone, value }: { lang: Lang; label: string; tone: "blue" | "green" | "orange"; value: string }) {
  return (
    <View style={[styles.metricCard, tone === "green" ? styles.metricGreen : null, tone === "orange" ? styles.metricOrange : null]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ lang, status }: { lang: Lang; status: AlertStatus }) {
  return (
    <View
      style={[
        styles.badge,
        status === "triggered" ? styles.badgeTriggered : null,
        status === "paused" ? styles.badgePaused : null
      ]}
    >
      <Text style={styles.badgeText}>{formatStatus(status, lang)}</Text>
    </View>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function Pill({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active ? styles.pillActive : null]}>
      <Text style={[styles.pillText, active ? styles.pillTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function LanguageButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.languageButton, active ? styles.languageButtonActive : null]}>
      <Text style={[styles.languageButtonText, active ? styles.languageButtonTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

function pick(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

function formatStatus(status: AlertStatus, lang: Lang): string {
  if (status === "active") {
    return pick(lang, "Active", "监控中");
  }
  if (status === "triggered") {
    return pick(lang, "Triggered", "已命中");
  }
  return pick(lang, "Paused", "已暂停");
}

function formatType(type: AlertType, lang: Lang): string {
  if (type === "price") {
    return pick(lang, "Price alert", "价格提醒");
  }
  if (type === "wallet") {
    return pick(lang, "Wallet alert", "钱包异动");
  }
  return pick(lang, "NFT alert", "NFT 动态");
}

function walletWatchDescription(kind: WalletWatchKind, lang: Lang): string {
  if (kind === "receive_transfer") {
    return pick(lang, "Best for incoming SOL or SPL token transfers.", "适合监控钱包收到 SOL 或 SPL 代币的入账变化。");
  }
  if (kind === "send_transfer") {
    return pick(lang, "Best for outgoing funds and abnormal deductions.", "适合监控资金被转出，及时发现异常扣款或手动转账。");
  }
  if (kind === "new_token") {
    return pick(lang, "Best for the first appearance of a new token, including airdrops or fresh buys.", "适合监控钱包第一次出现某个新代币，包括空投和新买入资产。");
  }
  return pick(lang, "Best for newly received NFTs.", "适合监控钱包收到新的 NFT。");
}

function walletAlertName(kind: WalletWatchKind, lang: Lang): string {
  if (kind === "receive_transfer") {
    return pick(lang, "Incoming wallet transfer", "钱包收到转账");
  }
  if (kind === "send_transfer") {
    return pick(lang, "Outgoing wallet transfer", "钱包转出资产");
  }
  if (kind === "new_token") {
    return pick(lang, "New token in wallet", "钱包出现新代币");
  }
  return pick(lang, "NFT received in wallet", "钱包收到 NFT");
}

function walletCondition(kind: WalletWatchKind, lang: Lang): string {
  if (kind === "receive_transfer") {
    return pick(lang, "Detect incoming SOL or SPL token transfers", "检测到 SOL 或 SPL 代币转入");
  }
  if (kind === "send_transfer") {
    return pick(lang, "Detect outgoing SOL or SPL token transfers", "检测到 SOL 或 SPL 代币转出");
  }
  if (kind === "new_token") {
    return pick(lang, "Detect a newly appeared token asset", "检测到钱包新增代币资产");
  }
  return pick(lang, "Detect a newly received NFT", "检测到收到新的 NFT");
}

function priceAlertName(symbol: string, direction: PriceDirection, targetPrice: number, lang: Lang): string {
  return pick(lang, `${symbol} ${direction === "above" ? "above" : "below"} ${targetPrice}`, `${symbol} ${direction === "above" ? "高于" : "低于"} ${targetPrice}`);
}

function priceConditionLabel(direction: PriceDirection, targetPrice: number, currentPrice: number | undefined, lang: Lang): string {
  const base = pick(lang, `Price ${direction === "above" ? "above" : "below"} ${targetPrice}`, `价格${direction === "above" ? "高于" : "低于"} ${targetPrice}`);
  return currentPrice != null ? pick(lang, `${base}, current ${currentPrice.toFixed(4)}`, `${base}，当前 ${currentPrice.toFixed(4)}`) : base;
}

function previewAlertName(
  lang: Lang,
  type: AlertType,
  priceSymbol: string | undefined,
  priceDirection: PriceDirection,
  priceThreshold: string,
  walletWatchKind: WalletWatchKind,
  nftCollection: NftCollection,
  nftDirection: PriceDirection,
  nftThreshold: string
): string {
  if (type === "price") {
    const symbol = priceSymbol ?? pick(lang, "Token", "代币");
    return pick(lang, `${symbol} ${priceDirection === "above" ? "above" : "below"} ${priceThreshold || "--"}`, `${symbol} ${priceDirection === "above" ? "高于" : "低于"} ${priceThreshold || "--"}`);
  }
  if (type === "wallet") {
    return walletAlertName(walletWatchKind, lang);
  }
  return pick(lang, `${nftCollection} floor ${nftDirection === "above" ? "above" : "below"} ${nftThreshold || "--"}`, `${nftCollection} 地板价${nftDirection === "above" ? "高于" : "低于"} ${nftThreshold || "--"}`);
}

function previewTarget(
  lang: Lang,
  type: AlertType,
  priceSymbol: string | undefined,
  nftCollection: NftCollection,
  walletAddress: string
): string {
  if (type === "price") {
    return `${priceSymbol ?? pick(lang, "Token", "代币")} / USDC`;
  }
  if (type === "wallet") {
    return walletAddress;
  }
  return nftCollection;
}

function previewCondition(
  lang: Lang,
  type: AlertType,
  priceDirection: PriceDirection,
  priceThreshold: string,
  walletWatchKind: WalletWatchKind,
  nftDirection: PriceDirection,
  nftThreshold: string
): string {
  if (type === "price") {
    return pick(lang, `Price ${priceDirection === "above" ? "above" : "below"} ${priceThreshold || "--"}`, `价格${priceDirection === "above" ? "高于" : "低于"} ${priceThreshold || "--"}`);
  }
  if (type === "wallet") {
    return walletCondition(walletWatchKind, lang);
  }
  return pick(lang, `Floor ${nftDirection === "above" ? "above" : "below"} ${nftThreshold || "--"} SOL`, `Floor ${nftDirection === "above" ? "高于" : "低于"} ${nftThreshold || "--"} SOL`);
}

function buildLocalAlert(
  type: AlertType,
  walletWatchKind: WalletWatchKind,
  nftCollection: NftCollection,
  nftDirection: PriceDirection,
  nftThreshold: string,
  walletAddress: string | undefined,
  lang: Lang
): RadarAlert | null {
  if (type === "wallet") {
    if (!walletAddress) {
      return null;
    }

    return {
      id: `alert_${Date.now()}`,
      name: previewAlertName(lang, type, undefined, "above", "", walletWatchKind, nftCollection, nftDirection, nftThreshold),
      type,
      status: "active",
      target: walletAddress,
      condition: walletCondition(walletWatchKind, lang),
      lastCheckedAt: pick(lang, "Just created", "刚刚创建"),
      walletWatchKind
    };
  }

  const threshold = Number(nftThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null;
  }

  return {
    id: `alert_${Date.now()}`,
    name: previewAlertName(lang, type, undefined, "above", "", walletWatchKind, nftCollection, nftDirection, nftThreshold),
    type,
    status: "active",
    target: nftCollection,
    condition: pick(lang, `Floor ${nftDirection === "above" ? "above" : "below"} ${threshold} SOL`, `Floor ${nftDirection === "above" ? "高于" : "低于"} ${threshold} SOL`),
    lastCheckedAt: pick(lang, "Just created", "刚刚创建")
  };
}

function formatTimestamp(value: string | undefined, lang: Lang): string {
  if (!value) {
    return pick(lang, "Not checked", "未检查");
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(4);
}

function formatWalletEvent(event: WalletAlertEventRecord, lang: Lang): string {
  if (event.watchKind === "receive_transfer" || event.watchKind === "send_transfer") {
    return pick(lang, `Balance change ${formatSol(event.deltaLamports)} SOL | current ${formatSol(event.currentBalanceLamports)} SOL`, `余额变化 ${formatSol(event.deltaLamports)} SOL | 当前 ${formatSol(event.currentBalanceLamports)} SOL`);
  }

  return pick(lang, `${event.watchKind === "new_token" ? "New token" : "NFT"}: ${event.assetMint ?? "Unknown asset"}`, `${event.watchKind === "new_token" ? "新代币" : "NFT"}: ${event.assetMint ?? "未知资产"}`);
}

async function prepareNotifications(): Promise<void> {
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== "granted") {
    await Notifications.requestPermissionsAsync();
  }

  await Notifications.setNotificationChannelAsync(ALERT_NOTIFICATION_CHANNEL, {
    name: "Price Alerts",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "metal_gear_alert.wav",
    vibrationPattern: [0, 250, 150, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
  });
}

function loadWalletUi():
  | {
      MobileWalletProvider: (props: {
        chain: string;
        endpoint: string;
        identity: { name: string; uri: string };
        children: unknown;
      }) => unknown;
      useMobileWallet: () => {
        account?: { address: { toString: () => string } };
        connect: () => Promise<{ address: { toString: () => string } }>;
        disconnect: () => Promise<void>;
        signIn: (payload: {
          domain: string;
          statement: string;
          uri: string;
          version: string;
          chainId: string;
          nonce: string;
        }) => Promise<SignInResultRecord>;
      };
    }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@wallet-ui/react-native-web3js");
    return {
      MobileWalletProvider: mod.MobileWalletProvider,
      useMobileWallet: mod.useMobileWallet
    };
  } catch {
    return null;
  }
}

function useWalletBridge(nativeEnabled: boolean): {
  account?: { address: { toString: () => string } };
  connect: () => Promise<{ address: { toString: () => string } }>;
  disconnect: () => Promise<void>;
  signIn: (payload: {
    domain: string;
    statement: string;
    uri: string;
    version: string;
    chainId: string;
    nonce: string;
  }) => Promise<SignInResultRecord>;
} {
  if (nativeEnabled && walletUi) {
    const wallet = walletUi.useMobileWallet();
    return {
      account: wallet.account,
      connect: wallet.connect,
      disconnect: wallet.disconnect,
      signIn: wallet.signIn
    };
  }

  return {
    account: undefined,
    connect: async () => {
      throw new Error("native wallet unavailable in Expo Go");
    },
    disconnect: async () => undefined,
    signIn: async () => {
      throw new Error("native wallet unavailable in Expo Go");
    }
  };
}

function decodeEncodedText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function extractDomain(serverBaseUrl: string): string {
  try {
    return new URL(serverBaseUrl).hostname;
  } catch {
    return "seeker-alert.local";
  }
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#09111b"
  },
  appShell: {
    flex: 1
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12
  },
  rowBetweenTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  headerCopy: {
    flex: 1
  },
  brand: {
    color: "#f4f7fb",
    fontSize: 28,
    fontWeight: "800"
  },
  headerSub: {
    color: "#93a9c2",
    marginTop: 4
  },
  languageToggle: {
    flexDirection: "row",
    gap: 8
  },
  languageButton: {
    backgroundColor: "#132234",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#20354c",
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  languageButtonActive: {
    backgroundColor: "#1e4478",
    borderColor: "#2e6fcb"
  },
  languageButtonText: {
    color: "#a9bdd2",
    fontWeight: "700",
    fontSize: 12
  },
  languageButtonTextActive: {
    color: "#ffffff"
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 120
  },
  stack: {
    gap: 12
  },
  heroCard: {
    backgroundColor: "#102133",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f3d56"
  },
  heroEyebrow: {
    color: "#89c8ff",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  heroTitle: {
    color: "#f4f7fb",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 28
  },
  heroMeta: {
    color: "#97aec8",
    marginTop: 10
  },
  metricsRow: {
    flexDirection: "row",
    gap: 10
  },
  metricCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "#143351"
  },
  metricGreen: {
    backgroundColor: "#173b31"
  },
  metricOrange: {
    backgroundColor: "#4f3214"
  },
  metricValue: {
    color: "#f4f7fb",
    fontSize: 22,
    fontWeight: "800"
  },
  metricLabel: {
    color: "#b3c7dc",
    marginTop: 4,
    fontSize: 12
  },
  card: {
    backgroundColor: "#0f1824",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1a293a",
    gap: 8
  },
  previewCard: {
    backgroundColor: "#0a121b",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#24384f",
    gap: 6
  },
  sectionTitle: {
    color: "#f4f7fb",
    fontSize: 18,
    fontWeight: "700"
  },
  supportText: {
    color: "#8ea3ba",
    lineHeight: 18
  },
  label: {
    color: "#9eb3ca",
    fontSize: 12,
    marginTop: 4
  },
  input: {
    borderWidth: 1,
    borderColor: "#24384f",
    backgroundColor: "#0a121b",
    borderRadius: 12,
    color: "#f4f7fb",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  button: {
    backgroundColor: "#2576ff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700"
  },
  secondaryButton: {
    backgroundColor: "#1b2a3c",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  secondaryButtonText: {
    color: "#d9e3ef",
    fontWeight: "700"
  },
  primaryCta: {
    backgroundColor: "#ffb000",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8
  },
  primaryCtaText: {
    color: "#101822",
    fontWeight: "800"
  },
  alertRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    paddingVertical: 4
  },
  alertInfo: {
    flex: 1
  },
  alertName: {
    color: "#f4f7fb",
    fontSize: 15,
    fontWeight: "700"
  },
  alertMeta: {
    color: "#90a8c1",
    marginTop: 3,
    lineHeight: 18
  },
  detailText: {
    color: "#d5dfeb",
    lineHeight: 19
  },
  historyItem: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#1a293a",
    gap: 2
  },
  badge: {
    backgroundColor: "#123a68",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  badgeTriggered: {
    backgroundColor: "#1c5c46"
  },
  badgePaused: {
    backgroundColor: "#4b5866"
  },
  badgeText: {
    color: "#f4f7fb",
    fontSize: 12,
    fontWeight: "700"
  },
  tabBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: "row",
    backgroundColor: "#101822",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1a293a",
    padding: 8
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10
  },
  tabText: {
    color: "#788da4",
    fontWeight: "700"
  },
  tabTextActive: {
    color: "#ffffff"
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#26384d",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#0a121b"
  },
  pillActive: {
    backgroundColor: "#1e4478",
    borderColor: "#2e6fcb"
  },
  pillText: {
    color: "#b0c4d8",
    fontWeight: "600"
  },
  pillTextActive: {
    color: "#ffffff"
  }
});
