"use client"

import { Switch } from "./ui/switch"
import { FlaskConical, AlertCircle } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"
import { SettingsRow } from "@/components/settings/SettingsRow"

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();

  // Define feature order for display (allows custom ordering)
  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe'];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3.5">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-sm text-amber-900">
          <p className="font-medium">Beta Features</p>
          <p className="mt-1 text-amber-800">
            These features are still being tested. You may encounter issues, and we appreciate your feedback.
          </p>
        </div>
      </div>

      {featureOrder.map((featureKey) => (
        <SettingsRow
          key={featureKey}
          icon={<FlaskConical />}
          title={BETA_FEATURE_NAMES[featureKey]}
          description={BETA_FEATURE_DESCRIPTIONS[featureKey]}
          control={
            <Switch
              checked={betaFeatures[featureKey]}
              onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
            />
          }
        />
      ))}

      <p className="px-1 text-xs text-stone-500">
        When disabled, beta features will be hidden. Your existing meetings remain unaffected.
      </p>
    </div>
  );
}
