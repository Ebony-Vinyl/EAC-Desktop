// GENERATED FILE — do not edit by hand.
// Sources: .sync/plugins.json, plugin-distribution.json, and recommended pack registry (run generate-plugin-registry.mjs).
// plugin-sync:update-sources {"unified-market":{"npm":"dsh-unified-market"}}
// plugin-sync:distribution {"builtinPluginIds":["client-file-changes","compact","ds-harness-remote","dsh-boot-animation","dsh-wechat-plugin","eac-core-bridge","eac-locale-compat","easy-setup","external-links","file-changes","plugin-shield","settings-scroll-fix","ui-skin-deep-whale-manager","unified-market","viewport-lock","wallpaper-engine"],"recommendedPluginIds":["balance","better-sidebar","change-review","composer-dynamic-island","conversation-tweaks","dock-settings","dsh-navbar","dsh-raw-html","dsh-session-manager","message-rewind","mobile-fix","offpeak","picturereader","prompt-custom","soul-md"],"recommendedPackId":"dev.dsh-eac.desktop-recommended","pluginClasses":{"agent-teams":"external","balance":"recommended","better-sidebar":"recommended","change-review":"recommended","client-file-changes":"builtin","compact":"builtin","composer-dynamic-island":"recommended","computer-user":"external","conversation-tweaks":"recommended","dock-settings":"recommended","ds-harness-remote":"builtin","dsh-boot-animation":"builtin","dsh-dafeiyu":"external","dsh-feature-toggles":"external","dsh-navbar":"recommended","dsh-pet":"external","dsh-pet-settings":"external","dsh-phone":"external","dsh-raw-html":"recommended","dsh-session-manager":"recommended","dsh-stt":"external","dsh-undo":"external","dsh-webui-prompt-optimizer":"external","dsh-wechat-plugin":"builtin","dsh-whale-widget":"external","eac-core-bridge":"builtin","eac-locale-compat":"builtin","easy-setup":"builtin","external-links":"builtin","file-changes":"builtin","float-window":"external","font-custom":"external","image-paste":"external","meow-smooth":"external","message-rewind":"recommended","mobile-fix":"recommended","offpeak":"recommended","openclaw-bridge":"external","picturereader":"recommended","plugin-shield":"builtin","plugin-wizard":"external","prompt-custom":"recommended","settings-groups":"external","settings-scroll-fix":"builtin","side-session":"external","soul-md":"recommended","think-zh-expand-eac":"external","ui-skin-deep-whale-manager":"builtin","unified-market":"builtin","viewport-lock":"builtin","wallpaper-engine":"builtin"}}

export const PLUGIN_SYNC_REGISTRY = {
  "distribution": {
    "builtinPluginIds": [
      "client-file-changes",
      "compact",
      "ds-harness-remote",
      "dsh-boot-animation",
      "dsh-wechat-plugin",
      "eac-core-bridge",
      "eac-locale-compat",
      "easy-setup",
      "external-links",
      "file-changes",
      "plugin-shield",
      "settings-scroll-fix",
      "ui-skin-deep-whale-manager",
      "unified-market",
      "viewport-lock",
      "wallpaper-engine"
    ],
    "pluginClasses": {
      "agent-teams": "external",
      "balance": "recommended",
      "better-sidebar": "recommended",
      "change-review": "recommended",
      "client-file-changes": "builtin",
      "compact": "builtin",
      "composer-dynamic-island": "recommended",
      "computer-user": "external",
      "conversation-tweaks": "recommended",
      "dock-settings": "recommended",
      "ds-harness-remote": "builtin",
      "dsh-boot-animation": "builtin",
      "dsh-dafeiyu": "external",
      "dsh-feature-toggles": "external",
      "dsh-navbar": "recommended",
      "dsh-pet": "external",
      "dsh-pet-settings": "external",
      "dsh-phone": "external",
      "dsh-raw-html": "recommended",
      "dsh-session-manager": "recommended",
      "dsh-stt": "external",
      "dsh-undo": "external",
      "dsh-webui-prompt-optimizer": "external",
      "dsh-wechat-plugin": "builtin",
      "dsh-whale-widget": "external",
      "eac-core-bridge": "builtin",
      "eac-locale-compat": "builtin",
      "easy-setup": "builtin",
      "external-links": "builtin",
      "file-changes": "builtin",
      "float-window": "external",
      "font-custom": "external",
      "image-paste": "external",
      "meow-smooth": "external",
      "message-rewind": "recommended",
      "mobile-fix": "recommended",
      "offpeak": "recommended",
      "openclaw-bridge": "external",
      "picturereader": "recommended",
      "plugin-shield": "builtin",
      "plugin-wizard": "external",
      "prompt-custom": "recommended",
      "settings-groups": "external",
      "settings-scroll-fix": "builtin",
      "side-session": "external",
      "soul-md": "recommended",
      "think-zh-expand-eac": "external",
      "ui-skin-deep-whale-manager": "builtin",
      "unified-market": "builtin",
      "viewport-lock": "builtin",
      "wallpaper-engine": "builtin"
    },
    "recommendedPackId": "dev.dsh-eac.desktop-recommended",
    "recommendedPluginIds": [
      "balance",
      "better-sidebar",
      "change-review",
      "composer-dynamic-island",
      "conversation-tweaks",
      "dock-settings",
      "dsh-navbar",
      "dsh-raw-html",
      "dsh-session-manager",
      "message-rewind",
      "mobile-fix",
      "offpeak",
      "picturereader",
      "prompt-custom",
      "soul-md"
    ]
  },
  "entries": {
    "client-file-changes": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "@deepseek-ai/dsh-client-file-changes",
      "path": "dsh-desktop/assets/plugins/dsh-client-file-changes",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "@deepseek-ai/dsh-client-file-changes",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "compact": {
      "class": "manual",
      "kind": "plugin",
      "packageName": "dsh-compact",
      "path": "dsh-desktop/assets/plugins/dsh-compact",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "unknown",
        "reason": "package.json does not declare a source repository; do not infer one from the directory name"
      },
      "syncMode": "manual"
    },
    "ds-harness-remote": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "ds-harness-remote",
      "path": "dsh-desktop/assets/plugins/ds-harness-remote",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "github",
        "name": "liguobao/ds-harness-remote",
        "repository": "https://github.com/liguobao/ds-harness-remote"
      },
      "syncMode": "manual"
    },
    "dsh-boot-animation": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "dsh-boot-animation",
      "path": "dsh-desktop/assets/plugins/dsh-boot-animation",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "github",
        "name": "NativeDog1/dsh-boot-animation",
        "repository": "https://github.com/NativeDog1/dsh-boot-animation"
      },
      "syncMode": "manual"
    },
    "dsh-wechat-plugin": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "dsh-wechat-plugin",
      "path": "dsh-desktop/assets/plugins/dsh-wechat",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "github",
        "name": "xcisxc29/dsh-wechat",
        "repository": "https://github.com/xcisxc29/dsh-wechat"
      },
      "syncMode": "manual"
    },
    "eac-core-bridge": {
      "class": "manual",
      "kind": "plugin",
      "packageName": "dsh-eac-core-bridge",
      "path": "dsh-desktop/assets/plugins/dsh-eac-core-bridge",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "unknown",
        "reason": "package.json does not declare a source repository; do not infer one from the directory name"
      },
      "syncMode": "manual"
    },
    "eac-locale-compat": {
      "class": "manual",
      "kind": "plugin",
      "packageName": "dsh-eac-locale-compat",
      "path": "dsh-desktop/assets/plugins/dsh-eac-locale-compat",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "unknown",
        "reason": "package.json does not declare a source repository; do not infer one from the directory name"
      },
      "syncMode": "manual"
    },
    "easy-setup": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "@deepseek-ai/dsh-easy-setup",
      "path": "dsh-desktop/assets/plugins/dsh-easy-setup",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "@deepseek-ai/dsh-easy-setup",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "external-links": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "dsh-external-links",
      "path": "dsh-desktop/assets/plugins/dsh-external-links",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "dsh-external-links",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "file-changes": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "@deepseek-ai/dsh-file-changes",
      "path": "dsh-desktop/assets/plugins/dsh-file-changes",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "@deepseek-ai/dsh-file-changes",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "plugin-shield": {
      "class": "manual",
      "kind": "plugin",
      "packageName": "dsh-plugin-shield",
      "path": "dsh-desktop/assets/plugins/dsh-plugin-shield",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "unknown",
        "reason": "package.json does not declare a source repository; do not infer one from the directory name"
      },
      "syncMode": "manual"
    },
    "settings-scroll-fix": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "dsh-settings-scroll-fix",
      "path": "dsh-desktop/assets/plugins/dsh-settings-scroll-fix",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "dsh-settings-scroll-fix",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "ui-skin-deep-whale-manager": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "@smalltailqwq/dsh-client-ui-skin-deep-whale-manager",
      "path": "dsh-desktop/assets/plugins/dsh-client-ui-skin-deep-whale-manager",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "github",
        "name": "Small-tailqwq/dsh-deep-whale",
        "repository": "https://github.com/Small-tailqwq/dsh-deep-whale"
      },
      "syncMode": "manual"
    },
    "unified-market": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "dsh-unified-market",
      "path": "dsh-desktop/assets/plugins/dsh-unified-market",
      "runtimeUpdate": {
        "allowed": true,
        "defaultAction": "prompt",
        "source": {
          "kind": "npm",
          "name": "dsh-unified-market"
        }
      },
      "source": {
        "kind": "npm",
        "name": "dsh-unified-market",
        "repository": "git+https://github.com/jing-hy/dsh-unified-market.git"
      },
      "syncMode": "mirror"
    },
    "viewport-lock": {
      "class": "internal",
      "kind": "plugin",
      "packageName": "dsh-viewport-lock",
      "path": "dsh-desktop/assets/plugins/dsh-viewport-lock",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "internal",
        "name": "dsh-viewport-lock",
        "reason": "maintained in this repository; no external source is declared"
      },
      "syncMode": "manual"
    },
    "wallpaper-engine": {
      "class": "follow-upstream",
      "kind": "plugin",
      "packageName": "dsh-plugin-wallpaper-engine",
      "path": "dsh-desktop/assets/plugins/dsh-plugin-wallpaper-engine",
      "runtimeUpdate": {
        "allowed": false,
        "defaultAction": "prompt"
      },
      "source": {
        "kind": "github",
        "name": "elysia395/dsh-wallpaper-engine",
        "repository": "https://github.com/elysia395/dsh-wallpaper-engine"
      },
      "syncMode": "manual"
    }
  },
  "manifest": ".sync/plugins.json",
  "schemaVersion": 1,
  "updateSources": {
    "unified-market": {
      "npm": "dsh-unified-market"
    }
  }
} as const;
export const PLUGIN_UPDATE_SOURCES = PLUGIN_SYNC_REGISTRY.updateSources;
export const DISTRIBUTION_BUILTIN_PLUGIN_IDS = PLUGIN_SYNC_REGISTRY.distribution.builtinPluginIds;
export const RECOMMENDED_PACK_PLUGIN_IDS = PLUGIN_SYNC_REGISTRY.distribution.recommendedPluginIds;
export const PLUGIN_DISTRIBUTION_CLASSES = PLUGIN_SYNC_REGISTRY.distribution.pluginClasses;
export const RECOMMENDED_PACK_ID = PLUGIN_SYNC_REGISTRY.distribution.recommendedPackId;
export default PLUGIN_SYNC_REGISTRY;
