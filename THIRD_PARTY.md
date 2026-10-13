Text layout helpers are imported from the installed MIT-licensed
`circuit-to-canvas` dependency, pinned in package.json and bun.lock. Only the
used text helpers are bundled into the renderer; the Canvas renderer is used
by the test harness. The upstream license is included in the installed package.

The parity harness prepares an ignored workspace from that package to run all
original tests without modifying node_modules. Its checked-in hash manifest
verifies the pinned source, fixtures, and snapshots.

The SVG comparison dependency is patched through Bun's `patchedDependencies`.
`patches/circuit-to-svg@0.0.390.patch` backports the margin-condition fix from
https://github.com/tscircuit/circuit-to-svg/pull/838 and the green bottom-mask
color already present in upstream 0.0.450. The patch makes scalar and asymmetric
margins visible when the coverage flag is omitted or false. It changes the SVG
renderer itself; comparison fixtures and snapshot tolerances are unchanged.
Remove this backport when upgrading to a release containing the upstream fix.
