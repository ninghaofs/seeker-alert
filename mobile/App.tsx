import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Buffer } from "buffer";
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
type PricePairKey = "SOL_USDC" | "BONK_USDC" | "JUP_USDC";

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

type PricePairOption = {
  key: PricePairKey;
  label: string;
  inputMint: string;
  outputMint: string;
};

const SOLANA_CHAIN = "solana:mainnet";
const SOLANA_RPC_ENDPOINT = "https://api.mainnet-beta.solana.com";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const PRICE_PAIRS: PricePairOption[] = [
  { key: "SOL_USDC", label: "SOL / USDC", inputMint: SOL_MINT, outputMint: USDC_MINT },
  { key: "BONK_USDC", label: "BONK / USDC", inputMint: BONK_MINT, outputMint: USDC_MINT },
  { key: "JUP_USDC", label: "JUP / USDC", inputMint: JUP_MINT, outputMint: USDC_MINT }
];
const walletUi = loadWalletUi();
const walletNativeEnabled = Boolean(walletUi && (NativeModules as Record<string, unknown>).SolanaMobileWalletAdapter);
const ALERT_NOTIFICATION_CHANNEL = "price-alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

const seededAlerts: RadarAlert[] = [
  {
    id: "alert_madlads_floor",
    name: "Mad Lads 地板价跌破 55",
    type: "nft",
    status: "paused",
    target: "Mad Lads",
    condition: "Floor 低于 55 SOL",
    lastCheckedAt: "今天 11:20"
  }
];

export default function App() {
  if (!walletNativeEnabled || !walletUi) {
    return <RadarScreen nativeWalletEnabled={false} />;
  }

  const WalletProvider: any = walletUi.MobileWalletProvider;
  return (
    <WalletProvider
      chain={SOLANA_CHAIN}
      endpoint={SOLANA_RPC_ENDPOINT}
      identity={{ name: "Seeker Radar", uri: "https://seeker-radar.local" }}
    >
      <RadarScreen nativeWalletEnabled />
    </WalletProvider>
  );
}

function RadarScreen({ nativeWalletEnabled }: { nativeWalletEnabled: boolean }) {
  const wallet = useWalletBridge(nativeWalletEnabled);

  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [serverBaseUrl, setServerBaseUrl] = useState("https://your-firebase-functions-url/api");
  const [sessionToken, setSessionToken] = useState("");
  const [creatingAlert, setCreatingAlert] = useState(false);
  const [alerts, setAlerts] = useState<RadarAlert[]>(seededAlerts);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertRecord[]>([]);
  const [walletAlerts, setWalletAlerts] = useState<WalletAlertRecord[]>([]);
  const [priceAlertEvents, setPriceAlertEvents] = useState<PriceAlertEventRecord[]>([]);
  const [walletAlertEvents, setWalletAlertEvents] = useState<WalletAlertEventRecord[]>([]);
  const [radarStatus, setRadarStatus] = useState<RadarStatus | null>(null);
  const [createType, setCreateType] = useState<AlertType>("price");
  const [pricePairKey, setPricePairKey] = useState<PricePairKey>("SOL_USDC");
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
  const alertSoundPlayer = useAudioPlayer(require("./assets/alert_tone.wav"), { keepAudioSessionActive: true });
  const selectedPricePair = PRICE_PAIRS.find((item) => item.key === pricePairKey) ?? PRICE_PAIRS[0];
  const latestCheckedAtLabel = (() => {
    const latest = priceAlerts
      .map((item) => item.lastCheckedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return latest ? formatTimestamp(latest) : "等待检查";
  })();
  const autoCheckLabel = (() => {
    const intervalMs = radarStatus?.priceAlertIntervalMs;

    if (!intervalMs || intervalMs <= 0) {
      return "未配置";
    }
    if (intervalMs < 60000) {
      return `${Math.round(intervalMs / 1000)} 秒`;
    }

    return `${Math.round(intervalMs / 60000)} 分钟`;
  })();
  const convertLocalPriceAlert = (priceAlert: PriceAlertRecord): RadarAlert => {
    const comparator = priceAlert.direction === "above" ? "高于" : "低于";
    const nextCondition =
      priceAlert.currentPrice != null
        ? `价格${comparator} ${priceAlert.targetPrice}，当前 ${priceAlert.currentPrice.toFixed(2)}`
        : `价格${comparator} ${priceAlert.targetPrice}`;

    return {
      id: priceAlert.id,
      name: priceAlert.name,
      type: "price",
      status: priceAlert.status,
      target: priceAlert.pair,
      condition: nextCondition,
      lastCheckedAt: formatTimestamp(priceAlert.lastCheckedAt),
      lastTriggeredAt: priceAlert.lastTriggeredAt ? formatTimestamp(priceAlert.lastTriggeredAt) : undefined
    };
  };
  const convertRemoteWalletAlert = (walletAlert: WalletAlertRecord): RadarAlert => ({
    id: walletAlert.id,
    name: walletAlert.name,
    type: "wallet",
    status: walletAlert.status,
    target: walletAlert.walletAddress,
    condition: walletCondition(walletAlert.watchKind),
    lastCheckedAt: formatTimestamp(walletAlert.lastCheckedAt),
    lastTriggeredAt: walletAlert.lastTriggeredAt ? formatTimestamp(walletAlert.lastTriggeredAt) : undefined,
    walletWatchKind: walletAlert.watchKind
  });

  const walletAddress = wallet.account?.address?.toString?.() ?? "未连接";
  const walletConnected = walletAddress !== "未连接";
  const mergedAlerts = [...priceAlerts.map(convertLocalPriceAlert), ...walletAlerts.map(convertRemoteWalletAlert), ...alerts];
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
      void refreshPriceAlerts(false);
      void refreshPriceAlertEvents();
      void refreshWalletAlerts(false);
      void refreshWalletAlertEvents();
    }, 10000);

    return () => clearInterval(timer);
  }, [serverBaseUrl, sessionToken]);

  function show(message: string) {
    Alert.alert("提示", message);
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

  async function onConnectWallet() {
    if (!nativeWalletEnabled) {
      show("当前运行的是 Expo Go，不支持原生钱包连接。请打开已安装的 Dev Client。");
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
      show("钱包已连接并登录");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function onDisconnectWallet() {
    if (!nativeWalletEnabled) {
      show("当前运行的是 Expo Go，不支持原生钱包连接。请打开已安装的 Dev Client。");
      return;
    }

    try {
      await wallet.disconnect();
      setSessionToken("");
      show("钱包已断开");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  function onCreateAlert() {
    console.log("[radar] create alert pressed", { createType });
    if (creatingAlert) {
      return;
    }

    if (createType === "price") {
      const threshold = Number(priceThreshold);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        show("请输入有效的价格数字");
        return;
      }

      const directionLabel = priceDirection === "above" ? "高于" : "低于";
      void createPriceAlert(
        `${selectedPricePair.label.split(" / ")[0]} ${directionLabel} ${threshold}`,
        selectedPricePair.label,
        `价格${directionLabel} ${threshold}`,
        selectedPricePair.inputMint,
        selectedPricePair.outputMint
      );
      return;
    }

    if (createType === "wallet") {
      if (!walletConnected) {
        show("请先连接钱包");
        return;
      }

      void createWalletAlert(walletAddress, walletWatchKind);
      return;
    }

    const nextAlert = buildLocalAlert(
      createType,
      walletWatchKind,
      nftCollection,
      nftDirection,
      nftThreshold,
      walletConnected ? walletAddress : "未连接钱包"
    );
    if (!nextAlert) {
      show("请输入有效的数字");
      return;
    }

    setAlerts((current) => [nextAlert, ...current]);
    setActiveTab("alerts");
    show("提醒已创建");
  }

  async function createPriceAlert(
    name: string,
    pair: string,
    rawCondition: string,
    inputMint: string,
    outputMint: string
  ) {
    setCreatingAlert(true);
    try {
      console.log("[radar] creating price alert", { name, pair, inputMint, outputMint });
      const parsed = parsePriceCondition(rawCondition);
      await callApi("/api/radar/price-alerts", {
        method: "POST",
        body: JSON.stringify({
          name,
          pair,
          inputMint,
          outputMint,
          direction: parsed.direction,
          targetPrice: parsed.targetPrice
        })
      });
      await refreshPriceAlerts(false);
      setActiveTab("alerts");
      show("价格提醒已创建，并同步到后端");
    } catch (error) {
      console.log("[radar] create price alert failed", error);
      show(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingAlert(false);
    }
  }

  async function createWalletAlert(nextWalletAddress: string, watchKind: WalletWatchKind) {
    setCreatingAlert(true);
    try {
      console.log("[radar] creating wallet alert", { nextWalletAddress, watchKind });
      await callApi("/api/radar/wallet-alerts", {
        method: "POST",
        body: JSON.stringify({
          name: walletAlertName(watchKind),
          walletAddress: nextWalletAddress,
          watchKind
        })
      });
      await refreshWalletAlerts(false);
      setActiveTab("alerts");
      show("钱包提醒已创建，并同步到后端");
    } catch (error) {
      console.log("[radar] create wallet alert failed", error);
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
        show(data.length === 0 ? "后端里还没有价格提醒" : `已刷新 ${data.length} 条价格提醒`);
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
        show(data.length === 0 ? "后端里还没有钱包提醒" : `已刷新 ${data.length} 条钱包提醒`);
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
          title: "Seeker Radar 测试提醒",
          body: "这是一条测试通知，用来确认声音和系统通知是否正常。",
          sound: "alert_tone.wav"
        },
        trigger: {
          type: "channel",
          channelId: ALERT_NOTIFICATION_CHANNEL
        } as unknown as Notifications.NotificationTriggerInput
      });
      show("测试通知已发送");
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
      newlyTriggered.length === 1 ? `${first.name} 已命中` : `${first.name} 等 ${newlyTriggered.length} 条提醒已命中`;

    void alertSoundPlayer.seekTo(0).catch(() => undefined);
    alertSoundPlayer.play();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: "Seeker Radar 提醒命中",
        body: message,
        sound: "alert_tone.wav"
      },
      trigger: {
        type: "channel",
        channelId: ALERT_NOTIFICATION_CHANNEL
      } as unknown as Notifications.NotificationTriggerInput
    });

    if (message !== lastTriggeredNotice) {
      setLastTriggeredNotice(message);
      Alert.alert("提醒命中", message);
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
    const message = `${first.name} 已命中`;
    void alertSoundPlayer.seekTo(0).catch(() => undefined);
    alertSoundPlayer.play();
    void Notifications.scheduleNotificationAsync({
      content: {
        title: "Seeker Radar 钱包异动",
        body: message,
        sound: "alert_tone.wav"
      },
      trigger: {
        type: "channel",
        channelId: ALERT_NOTIFICATION_CHANNEL
      } as unknown as Notifications.NotificationTriggerInput
    });
  }

  async function checkPriceAlerts() {
    try {
      const result = (await callApi("/api/radar/price-alerts/check", { method: "POST" })) as {
        alerts: PriceAlertRecord[];
      };
      setPriceAlerts(result.alerts);
      show("价格提醒已检查");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkWalletAlerts() {
    try {
      const result = (await callApi("/api/radar/wallet-alerts/check", { method: "POST" })) as {
        alerts: WalletAlertRecord[];
      };
      setWalletAlerts(result.alerts);
      show("钱包提醒已检查");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
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
      show(nextStatus === "paused" ? "价格提醒已暂停" : "价格提醒已恢复");
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
      show("价格提醒已删除");
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
      show(nextStatus === "paused" ? "钱包提醒已暂停" : "钱包提醒已恢复");
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
      show("钱包提醒已删除");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function loginWithWallet(nextWalletAddress?: string) {
    const resolvedWalletAddress = nextWalletAddress ?? wallet.account?.address?.toString?.();
    if (!resolvedWalletAddress) {
      throw new Error("钱包还没有返回地址");
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
      statement: "Sign in to Seeker Radar",
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
      throw new Error("请先连接钱包并完成登录");
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
          <Text style={styles.brand}>Seeker Radar</Text>
          <Text style={styles.headerSub}>移动端链上提醒中心</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {activeTab === "home" ? (
            <HomeTab
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
              createType={createType}
              nftCollection={nftCollection}
              nftDirection={nftDirection}
              nftThreshold={nftThreshold}
              pricePairKey={pricePairKey}
              priceDirection={priceDirection}
              priceThreshold={priceThreshold}
              walletAddress={walletConnected ? walletAddress : "未连接钱包"}
              walletWatchKind={walletWatchKind}
              onCreateAlert={onCreateAlert}
              creatingAlert={creatingAlert}
              onSetCreateType={setCreateType}
              onSetNftCollection={setNftCollection}
              onSetNftDirection={setNftDirection}
              onSetNftThreshold={setNftThreshold}
              onSetPricePairKey={setPricePairKey}
              onSetPriceDirection={setPriceDirection}
              onSetPriceThreshold={setPriceThreshold}
              onSetWalletWatchKind={setWalletWatchKind}
            />
          ) : null}

          {activeTab === "me" ? (
            <MeTab
              nativeWalletEnabled={nativeWalletEnabled}
              onTestAlertNotification={testAlertNotification}
              serverBaseUrl={serverBaseUrl}
              walletAddress={walletAddress}
              walletConnected={walletConnected}
              onConnectWallet={onConnectWallet}
              onDisconnectWallet={onDisconnectWallet}
              onSetServerBaseUrl={setServerBaseUrl}
            />
          ) : null}
        </ScrollView>

        <View style={styles.tabBar}>
          <TabButton active={activeTab === "home"} label="首页" onPress={() => setActiveTab("home")} />
          <TabButton active={activeTab === "alerts"} label="提醒" onPress={() => setActiveTab("alerts")} />
          <TabButton active={activeTab === "create"} label="创建" onPress={() => setActiveTab("create")} />
          <TabButton active={activeTab === "me"} label="我的" onPress={() => setActiveTab("me")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function HomeTab({
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
        <Text style={styles.heroEyebrow}>今日状态</Text>
        <Text style={styles.heroTitle}>钱包动态和价格提醒都集中在这里。</Text>
        <Text style={styles.heroMeta}>钱包：{walletAddress}</Text>
      </View>

      <View style={styles.metricsRow}>
        <MetricCard label="运行中提醒" value={String(activeCount)} tone="blue" />
        <MetricCard label="今日命中" value={String(triggeredToday)} tone="green" />
        <MetricCard label="最近检查" value={latestCheckedAt} tone="orange" />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>快捷创建</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => onQuickCreate("price")}>
            <Text style={styles.buttonText}>价格提醒</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => onQuickCreate("wallet")}>
            <Text style={styles.buttonText}>钱包异动</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => onQuickCreate("nft")}>
            <Text style={styles.buttonText}>NFT 动态</Text>
          </Pressable>
        </View>
        <Text style={styles.supportText}>价格提醒由后端自动检查，当前频率：{autoCheckLabel}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void onCheckPriceAlerts()}>
          <Text style={styles.secondaryButtonText}>手动检查价格提醒</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>最近提醒</Text>
        {alerts.slice(0, 3).map((item) => (
          <View key={item.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{item.name}</Text>
              <Text style={styles.alertMeta}>
                {formatType(item.type)} | {item.condition}
              </Text>
            </View>
            <StatusBadge status={item.status} />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>最近命中记录</Text>
        {recentEvents.length === 0 ? <Text style={styles.supportText}>还没有价格提醒命中记录。</Text> : null}
        {recentEvents.slice(0, 3).map((event) => (
          <View key={event.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{event.alertName}</Text>
              <Text style={styles.alertMeta}>
                {event.pair} | 当前 {event.currentPrice.toFixed(4)} | {formatTimestamp(event.triggeredAt)}
              </Text>
            </View>
            <StatusBadge status="triggered" />
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>最近钱包异动</Text>
        {recentWalletEvents.length === 0 ? <Text style={styles.supportText}>还没有钱包异动记录。</Text> : null}
        {recentWalletEvents.slice(0, 3).map((event) => (
          <View key={event.id} style={styles.alertRow}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{event.alertName}</Text>
              <Text style={styles.alertMeta}>
                {formatWalletEvent(event)} | {formatTimestamp(event.triggeredAt)}
              </Text>
            </View>
            <StatusBadge status="triggered" />
          </View>
        ))}
      </View>
    </View>
  );
}

function AlertsTab({
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
  onToggleStatus
  ,
  onTogglePriceAlert,
  onToggleWalletAlert
}: {
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
        <Text style={styles.sectionTitle}>我的提醒</Text>
        <Text style={styles.supportText}>价格提醒由后端监控，当前自动检查频率：{autoCheckLabel}。</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => void onRefreshPriceAlerts()}>
            <Text style={styles.buttonText}>刷新价格提醒</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onCheckPriceAlerts()}>
            <Text style={styles.secondaryButtonText}>检查价格提醒</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshPriceAlertEvents()}>
            <Text style={styles.secondaryButtonText}>刷新命中历史</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshWalletAlerts()}>
            <Text style={styles.secondaryButtonText}>刷新钱包提醒</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void onCheckWalletAlerts()}>
            <Text style={styles.secondaryButtonText}>检查钱包提醒</Text>
          </Pressable>
        </View>
      </View>

      {alerts.map((item) => (
        <View key={item.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.alertInfo}>
              <Text style={styles.alertName}>{item.name}</Text>
              <Text style={styles.alertMeta}>{formatType(item.type)}</Text>
            </View>
            <StatusBadge status={item.status} />
          </View>
          <Text style={styles.detailText}>监控对象：{item.target}</Text>
          <Text style={styles.detailText}>触发条件：{item.condition}</Text>
          <Text style={styles.detailText}>最后检查：{item.lastCheckedAt}</Text>
          <Text style={styles.detailText}>最近触发：{item.lastTriggeredAt ?? "暂无"}</Text>
          {item.type === "price" ? (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void onTogglePriceAlert(item.id, item.status)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? "恢复" : "暂停"}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void onDeletePriceAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>删除</Text>
              </Pressable>
            </View>
          ) : item.type === "wallet" ? (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void onToggleWalletAlert(item.id, item.status)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? "恢复" : "暂停"}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void onDeleteWalletAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>删除</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => onToggleStatus(item.id)}>
                <Text style={styles.buttonText}>{item.status === "paused" ? "恢复" : "暂停"}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => onDeleteAlert(item.id)}>
                <Text style={styles.secondaryButtonText}>删除</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}

      {alerts.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>还没有提醒</Text>
          <Text style={styles.supportText}>先去“创建”页面新建一条价格、钱包或 NFT 提醒，再回到这里刷新查看。</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>命中历史</Text>
        {priceAlertEvents.length === 0 ? <Text style={styles.supportText}>还没有历史记录。</Text> : null}
        {priceAlertEvents.slice(0, 8).map((event) => (
          <View key={event.id} style={styles.historyItem}>
            <Text style={styles.alertName}>{event.alertName}</Text>
            <Text style={styles.alertMeta}>
              {event.pair} | 目标 {event.targetPrice} | 当前 {event.currentPrice.toFixed(4)}
            </Text>
            <Text style={styles.supportText}>{formatTimestamp(event.triggeredAt)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>钱包异动历史</Text>
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={() => void onRefreshWalletAlertEvents()}>
            <Text style={styles.secondaryButtonText}>刷新钱包历史</Text>
          </Pressable>
        </View>
        {walletAlertEvents.length === 0 ? <Text style={styles.supportText}>还没有钱包异动历史。</Text> : null}
        {walletAlertEvents.slice(0, 8).map((event) => (
          <View key={event.id} style={styles.historyItem}>
            <Text style={styles.alertName}>{event.alertName}</Text>
            <Text style={styles.alertMeta}>
              {formatWalletEvent(event)}
            </Text>
            <Text style={styles.supportText}>{formatTimestamp(event.triggeredAt)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CreateTab({
  createType,
  creatingAlert,
  nftCollection,
  nftDirection,
  nftThreshold,
  pricePairKey,
  priceDirection,
  priceThreshold,
  walletAddress,
  walletWatchKind,
  onCreateAlert,
  onSetCreateType,
  onSetNftCollection,
  onSetNftDirection,
  onSetNftThreshold,
  onSetPricePairKey,
  onSetPriceDirection,
  onSetPriceThreshold,
  onSetWalletWatchKind
}: {
  createType: AlertType;
  creatingAlert: boolean;
  nftCollection: NftCollection;
  nftDirection: PriceDirection;
  nftThreshold: string;
  pricePairKey: PricePairKey;
  priceDirection: PriceDirection;
  priceThreshold: string;
  walletAddress: string;
  walletWatchKind: WalletWatchKind;
  onCreateAlert: () => void;
  onSetCreateType: (value: AlertType) => void;
  onSetNftCollection: (value: NftCollection) => void;
  onSetNftDirection: (value: PriceDirection) => void;
  onSetNftThreshold: (value: string) => void;
  onSetPricePairKey: (value: PricePairKey) => void;
  onSetPriceDirection: (value: PriceDirection) => void;
  onSetPriceThreshold: (value: string) => void;
  onSetWalletWatchKind: (value: WalletWatchKind) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>创建提醒</Text>
        <Text style={styles.supportText}>先把提醒做成本地可用 MVP，后面再接服务端推送。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>提醒类型</Text>
        <View style={styles.row}>
          <Pill active={createType === "price"} label="价格" onPress={() => onSetCreateType("price")} />
          <Pill active={createType === "wallet"} label="钱包" onPress={() => onSetCreateType("wallet")} />
          <Pill active={createType === "nft"} label="NFT" onPress={() => onSetCreateType("nft")} />
        </View>

        {createType === "price" ? (
          <>
            <Text style={styles.label}>监控交易对</Text>
            <View style={styles.row}>
              {PRICE_PAIRS.map((pair) => (
                <Pill key={pair.key} active={pricePairKey === pair.key} label={pair.label} onPress={() => onSetPricePairKey(pair.key)} />
              ))}
            </View>
            <Text style={styles.supportText}>交易对从固定选项中选择，避免输入错误的 mint 或符号。</Text>

            <Text style={styles.label}>触发方向</Text>
            <View style={styles.row}>
              <Pill active={priceDirection === "above"} label="价格高于" onPress={() => onSetPriceDirection("above")} />
              <Pill active={priceDirection === "below"} label="价格低于" onPress={() => onSetPriceDirection("below")} />
            </View>

            <Text style={styles.label}>目标价格</Text>
            <Text style={styles.supportText}>这里只输入数字，条件文案会自动生成。</Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={onSetPriceThreshold}
              placeholder="例如 200"
              placeholderTextColor="#6f8195"
              style={styles.input}
              value={priceThreshold}
            />
          </>
        ) : null}

        {createType === "wallet" ? (
          <>
            <Text style={styles.label}>监控对象</Text>
            <Text style={styles.detailText}>{walletAddress}</Text>
            <Text style={styles.supportText}>钱包提醒固定监控当前连接的钱包地址。</Text>

            <Text style={styles.label}>重点监控什么异动</Text>
            <View style={styles.row}>
              <Pill
                active={walletWatchKind === "receive_transfer"}
                label="收到转账"
                onPress={() => onSetWalletWatchKind("receive_transfer")}
              />
              <Pill
                active={walletWatchKind === "send_transfer"}
                label="转出资产"
                onPress={() => onSetWalletWatchKind("send_transfer")}
              />
              <Pill active={walletWatchKind === "new_token"} label="新代币" onPress={() => onSetWalletWatchKind("new_token")} />
              <Pill active={walletWatchKind === "receive_nft"} label="收到 NFT" onPress={() => onSetWalletWatchKind("receive_nft")} />
            </View>
            <Text style={styles.supportText}>钱包提醒现在走后端真实监听：SOL 余额变化、新代币出现、收到 NFT。</Text>
            <Text style={styles.supportText}>{walletWatchDescription(walletWatchKind)}</Text>
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

            <Text style={styles.label}>触发方向</Text>
            <View style={styles.row}>
              <Pill active={nftDirection === "above"} label="地板价高于" onPress={() => onSetNftDirection("above")} />
              <Pill active={nftDirection === "below"} label="地板价低于" onPress={() => onSetNftDirection("below")} />
            </View>

            <Text style={styles.label}>目标价格</Text>
            <Text style={styles.supportText}>这里只输入数字，NFT 提醒名称和条件会自动生成。</Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={onSetNftThreshold}
              placeholder="例如 55"
              placeholderTextColor="#6f8195"
              style={styles.input}
              value={nftThreshold}
            />
          </>
        ) : null}

        <View style={styles.previewCard}>
          <Text style={styles.label}>将要创建的提醒</Text>
          <Text style={styles.alertName}>
            {previewAlertName(createType, pricePairKey, priceDirection, priceThreshold, walletWatchKind, nftCollection, nftDirection, nftThreshold)}
          </Text>
          <Text style={styles.detailText}>监控对象：{previewTarget(createType, pricePairKey, nftCollection, walletAddress)}</Text>
          <Text style={styles.detailText}>触发条件：{previewCondition(createType, priceDirection, priceThreshold, walletWatchKind, nftDirection, nftThreshold)}</Text>
        </View>

        <Pressable style={styles.primaryCta} onPress={onCreateAlert}>
          <Text style={styles.primaryCtaText}>{creatingAlert ? "创建中..." : "创建提醒"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MeTab({
  nativeWalletEnabled,
  onTestAlertNotification,
  serverBaseUrl,
  walletAddress,
  walletConnected,
  onConnectWallet,
  onDisconnectWallet,
  onSetServerBaseUrl
}: {
  nativeWalletEnabled: boolean;
  onTestAlertNotification: () => Promise<void>;
  serverBaseUrl: string;
  walletAddress: string;
  walletConnected: boolean;
  onConnectWallet: () => Promise<void>;
  onDisconnectWallet: () => Promise<void>;
  onSetServerBaseUrl: (value: string) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>钱包</Text>
        <Text style={styles.detailText}>当前地址：{walletAddress}</Text>
        <Text style={styles.supportText}>{nativeWalletEnabled ? "使用已安装的 Seeker Dev Client 连接钱包。" : "当前是 Expo Go，仅能预览界面。"}</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={walletConnected ? onDisconnectWallet : onConnectWallet}>
            <Text style={styles.buttonText}>{walletConnected ? "断开连接" : "连接钱包"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>服务配置</Text>
        <Text style={styles.label}>后端地址</Text>
        <TextInput autoCapitalize="none" onChangeText={onSetServerBaseUrl} style={styles.input} value={serverBaseUrl} />
        <Text style={styles.supportText}>后续提醒同步、推送 token 注册、链上监听服务都走这个地址。</Text>
        <View style={styles.row}>
          <Pressable style={styles.secondaryButton} onPress={() => void onTestAlertNotification()}>
            <Text style={styles.secondaryButtonText}>测试通知声音</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MetricCard({ label, tone, value }: { label: string; tone: "blue" | "green" | "orange"; value: string }) {
  return (
    <View style={[styles.metricCard, tone === "green" ? styles.metricGreen : null, tone === "orange" ? styles.metricOrange : null]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: AlertStatus }) {
  return (
    <View
      style={[
        styles.badge,
        status === "triggered" ? styles.badgeTriggered : null,
        status === "paused" ? styles.badgePaused : null
      ]}
    >
      <Text style={styles.badgeText}>{formatStatus(status)}</Text>
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

function formatStatus(status: AlertStatus): string {
  if (status === "active") {
    return "监控中";
  }
  if (status === "triggered") {
    return "已命中";
  }
  return "已暂停";
}

function formatType(type: AlertType): string {
  if (type === "price") {
    return "价格提醒";
  }
  if (type === "wallet") {
    return "钱包异动";
  }
  if (type === "nft") {
    return "NFT 动态";
  }
  return "链上事件";
}

function walletWatchDescription(kind: WalletWatchKind): string {
  if (kind === "receive_transfer") {
    return "适合监控钱包收到 SOL 或 SPL 代币的入账变化。";
  }
  if (kind === "send_transfer") {
    return "适合监控资金被转出，及时发现异常扣款或手动转账。";
  }
  if (kind === "new_token") {
    return "适合监控钱包第一次出现某个新代币，包括空投和新买入资产。";
  }
  return "适合监控钱包收到新的 NFT 或 compressed NFT。";
}

function walletAlertName(kind: WalletWatchKind): string {
  if (kind === "receive_transfer") {
    return "钱包收到转账";
  }
  if (kind === "send_transfer") {
    return "钱包转出资产";
  }
  if (kind === "new_token") {
    return "钱包出现新代币";
  }
  return "钱包收到 NFT";
}

function walletCondition(kind: WalletWatchKind): string {
  if (kind === "receive_transfer") {
    return "检测到 SOL 或 SPL 代币转入";
  }
  if (kind === "send_transfer") {
    return "检测到 SOL 或 SPL 代币转出";
  }
  if (kind === "new_token") {
    return "检测到钱包新增代币资产";
  }
  return "检测到收到新的 NFT";
}

function previewAlertName(
  type: AlertType,
  pricePairKey: PricePairKey,
  priceDirection: PriceDirection,
  priceThreshold: string,
  walletWatchKind: WalletWatchKind,
  nftCollection: NftCollection,
  nftDirection: PriceDirection,
  nftThreshold: string
): string {
  if (type === "price") {
    const symbol = (PRICE_PAIRS.find((item) => item.key === pricePairKey) ?? PRICE_PAIRS[0]).label.split(" / ")[0];
    return `${symbol} ${priceDirection === "above" ? "高于" : "低于"} ${priceThreshold || "--"}`;
  }
  if (type === "wallet") {
    if (walletWatchKind === "receive_transfer") {
      return "主钱包收到转账";
    }
    if (walletWatchKind === "send_transfer") {
      return "主钱包转出资产";
    }
    if (walletWatchKind === "new_token") {
      return "主钱包出现新代币";
    }
    return "主钱包收到 NFT";
  }
  return `${nftCollection} 地板价${nftDirection === "above" ? "高于" : "低于"} ${nftThreshold || "--"}`;
}

function previewTarget(type: AlertType, pricePairKey: PricePairKey, nftCollection: NftCollection, walletAddress: string): string {
  if (type === "price") {
    return (PRICE_PAIRS.find((item) => item.key === pricePairKey) ?? PRICE_PAIRS[0]).label;
  }
  if (type === "wallet") {
    return walletAddress;
  }
  return nftCollection;
}

function previewCondition(
  type: AlertType,
  priceDirection: PriceDirection,
  priceThreshold: string,
  walletWatchKind: WalletWatchKind,
  nftDirection: PriceDirection,
  nftThreshold: string
): string {
  if (type === "price") {
    return `价格${priceDirection === "above" ? "高于" : "低于"} ${priceThreshold || "--"}`;
  }
  if (type === "wallet") {
    return walletCondition(walletWatchKind);
  }
  return `Floor ${nftDirection === "above" ? "高于" : "低于"} ${nftThreshold || "--"} SOL`;
}

function buildLocalAlert(
  type: AlertType,
  walletWatchKind: WalletWatchKind,
  nftCollection: NftCollection,
  nftDirection: PriceDirection,
  nftThreshold: string,
  walletAddress: string
): RadarAlert | null {
  if (type === "wallet") {
    if (walletAddress === "未连接钱包") {
      return null;
    }

    return {
      id: `alert_${Date.now()}`,
      name: previewAlertName(type, "SOL_USDC", "above", "", walletWatchKind, nftCollection, nftDirection, nftThreshold),
      type,
      status: "active",
      target: walletAddress,
      condition: walletCondition(walletWatchKind),
      lastCheckedAt: "刚刚创建",
      walletWatchKind
    };
  }

  const threshold = Number(nftThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return null;
  }

  return {
    id: `alert_${Date.now()}`,
    name: previewAlertName(type, "SOL_USDC", "above", "", walletWatchKind, nftCollection, nftDirection, nftThreshold),
    type,
    status: "active",
    target: nftCollection,
    condition: `Floor ${nftDirection === "above" ? "高于" : "低于"} ${threshold} SOL`,
    lastCheckedAt: "刚刚创建"
  };
}

function parsePriceCondition(rawCondition: string): { direction: "above" | "below"; targetPrice: number } {
  const normalized = rawCondition.trim().toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);

  if (!match) {
    throw new Error("价格条件里没有识别到数字，例如“价格高于 200”");
  }

  const targetPrice = Number(match[1]);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    throw new Error("价格条件里的数字无效");
  }

  const direction = normalized.includes("低于") || normalized.includes("below") ? "below" : "above";
  return { direction, targetPrice };
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "未检查";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(4);
}

function formatWalletEvent(event: WalletAlertEventRecord): string {
  if (event.watchKind === "receive_transfer" || event.watchKind === "send_transfer") {
    return `余额变化 ${formatSol(event.deltaLamports)} SOL | 当前 ${formatSol(event.currentBalanceLamports)} SOL`;
  }

  return `${event.watchKind === "new_token" ? "新代币" : "NFT"}: ${event.assetMint ?? "未知资产"}`;
}

async function prepareNotifications(): Promise<void> {
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== "granted") {
    await Notifications.requestPermissionsAsync();
  }

  await Notifications.setNotificationChannelAsync(ALERT_NOTIFICATION_CHANNEL, {
    name: "Price Alerts",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "alert_tone.wav",
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
    return "seeker-radar.local";
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
  brand: {
    color: "#f4f7fb",
    fontSize: 28,
    fontWeight: "800"
  },
  headerSub: {
    color: "#93a9c2",
    marginTop: 4
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
  value: {
    color: "#f4f7fb",
    lineHeight: 20
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
