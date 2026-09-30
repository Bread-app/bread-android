const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const resolveRequestWithPackageExports = (context, moduleName, platform) => {
  if (moduleName === 'isows') {
    const ctx = {
      ...context,
      unstable_enablePackageExports: false,
    };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }

  if (moduleName.startsWith('zustand')) {
    const ctx = {
      ...context,
      unstable_enablePackageExports: false,
    };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }

  if (moduleName === 'jose') {
    const ctx = {
      ...context,
      unstable_conditionNames: ['browser'],
    };
    return ctx.resolveRequest(ctx, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.resolveRequest = resolveRequestWithPackageExports;

/**
 * Defer each module's evaluation to its first use instead of running the whole
 * graph at startup.
 *
 * Expo's default resolves to `inlineRequires: false`, which meant every module
 * in the app — ~100k lines of source plus @solana/web3.js, Privy and Phoenix —
 * was parsed and executed before the first frame. That is the single largest
 * contributor to the app feeling slow everywhere, and it is worst in a dev
 * client.
 *
 * `experimentalImportSupport` is carried over from the default config, not
 * invented here: dropping it changes how ES module semantics are compiled.
 *
 * NOTE: inline requires turn latent circular imports into undefined-at-call-time
 * crashes, so the graph must stay acyclic. `bread-mobile/src` is cycle-free as
 * of the sandwich-screen extraction (the shared feed cards moved to
 * `components/sandwich-card.tsx` + `lib/sandwich-feed.ts` precisely so that
 * stock-detail-sheet and user-profile-screen no longer import it back).
 */
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
    inlineRequires: true,
  },
});

module.exports = config;
