declare const SceneIdBrand: unique symbol;
export type SceneId = string & { readonly [SceneIdBrand]: true };

declare const CampaignIdBrand: unique symbol;
export type CampaignId = string & { readonly [CampaignIdBrand]: true };

declare const ShotPlanIdBrand: unique symbol;
export type ShotPlanId = string & { readonly [ShotPlanIdBrand]: true };
