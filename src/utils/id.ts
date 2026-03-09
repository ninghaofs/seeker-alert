export const newId = (): string => {
  const rand = Math.random().toString(36).slice(2, 10);
  return `rule_${Date.now()}_${rand}`;
};
