/** Layering rules (ARCHITECTURE §2, ARCHITECTURE-M2 §2). Run by `npm run lint:deps`, part of `npm run check`. */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sim-core-pure',
      comment:
        'sim-core imports only itself and contracts/{units,suspension,vehicle,track,telemetry,sim,drive,world}.ts: no npm, no node, no kernel/features/ui/DOM (§2 rule 1).',
      severity: 'error',
      from: { path: '^src/sim-core/' },
      to: { pathNot: '^src/(sim-core/|contracts/(units|suspension|vehicle|track|telemetry|sim|drive|world)\\.ts$)' },
    },
    {
      name: 'contracts-only-contracts',
      comment: 'contracts import only other contracts, and TYPES from three/nanostores/mitt (§2).',
      severity: 'error',
      from: { path: '^src/contracts/' },
      to: { pathNot: '^(src/contracts/|node_modules/(@types/)?(three|nanostores|mitt)/)' },
    },
    {
      name: 'contracts-npm-types-only',
      comment: 'contracts may import three/nanostores/mitt for TYPES only.',
      severity: 'error',
      from: { path: '^src/contracts/' },
      to: { path: '^node_modules/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'features-no-cross-import',
      comment: 'A feature never imports another feature (§2 rule 2). Communicate via store/bus/services/registries.',
      severity: 'error',
      from: { path: '^src/features/([^/]+)/' },
      to: { path: '^src/features/', pathNot: '^src/features/$1/' },
    },
    {
      name: 'features-no-kernel',
      comment: 'Features get everything through FeatureContext; never import kernel, app or remote (§2 rule 2).',
      severity: 'error',
      from: { path: '^src/features/' },
      to: { path: '^src/(kernel|app|remote)/' },
    },
    {
      name: 'kernel-no-upper-layers',
      comment: 'kernel must not import features, ui, kit3d, app, remote (§2 rule 3).',
      severity: 'error',
      from: { path: '^src/kernel/' },
      to: { path: '^src/(features|ui|kit3d|app|remote)/' },
    },
    {
      name: 'ui-kit3d-no-upper-layers',
      comment: 'ui and kit3d must not import features or kernel (§2 rule 3).',
      severity: 'error',
      from: { path: '^src/(ui|kit3d)/' },
      to: { path: '^src/(features|kernel|app|remote)/' },
    },
    {
      name: 'remote-no-app-layers',
      comment: 'The phone remote imports contracts, sim-core content, ui and npm libs only (§2).',
      severity: 'error',
      from: { path: '^src/remote/' },
      to: { path: '^src/(kernel|features|kit3d|app)/' },
    },
    {
      name: 'worker-no-client',
      comment: 'worker must not import client layers nor client-only contracts (§2 rule 4).',
      severity: 'error',
      from: { path: '^worker/' },
      to: { path: ['^src/(kernel|features|ui|kit3d|app|remote)/', '^src/contracts/(app|services|events)\\.ts$'] },
    },
    {
      name: 'no-circular',
      comment: 'No circular dependencies; cycles that stay inside src/contracts (type-only) are allowed (§2 rule 5).',
      severity: 'error',
      from: { pathNot: '^src/contracts/' },
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve (cloudflare:* modules exist only in workerd).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: '^cloudflare:' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|\\.wrangler)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.d.ts', '.json'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
