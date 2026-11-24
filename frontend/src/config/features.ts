/**
 * Silent feature-tier registry for future public SaaS subscriptions.
 *
 * While `billing_enforced` is false (default), every feature is 100% unlocked
 * and `show_upgrade_ui` is false so zero Pro badges or paywalls appear in the UI.
 */

export type FeatureKey =
  | 'ml_predictions'
  | 'ml_boost'
  | 'dump_sniper'
  | 'discord_alerts'
  | 'extended_history_90d';

export interface Entitlements {
  billing_enforced: boolean;
  show_upgrade_ui: boolean;
  plan: 'free' | 'pro';
  features: Record<FeatureKey, boolean>;
}

export const FUTURE_PRO_FEATURES: readonly FeatureKey[] = [
  'ml_predictions',
  'ml_boost',
  'dump_sniper',
  'discord_alerts',
  'extended_history_90d',
] as const;

export function isFeatureEnabled(entitlements: Entitlements | undefined, key: FeatureKey): boolean {
  if (!entitlements || !entitlements.billing_enforced) return true;
  return entitlements.features[key] !== false;
}

export function shouldShowUpgradeUi(entitlements: Entitlements | undefined): boolean {
  return Boolean(entitlements?.billing_enforced && entitlements?.show_upgrade_ui);
}
