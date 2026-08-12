# Distribution & Cluster Baseline v1

This baseline freezes three production guarantees:

1. `@tibame201020/queqiao` is a self-contained npm artifact. Its CLI, Gateway, Worker,
   internal packages, and runtime dependencies are bundled into one tarball.
2. Gateway core is OS-independent. CI installs the packed artifact and runs the real
   Gateway on Linux, in addition to package-install checks on Linux and Windows.
3. A Gateway cannot route to a Worker until an authenticated compatibility handshake
   succeeds.

## Process roles

The package exposes `queqiao`, `queqiao-gateway`, and `queqiao-worker`. Installation
does not enable or launch a role. A host may run Gateway, Worker, both, or neither.

## Worker handshake

`GET /v1/hello` requires the Worker credential and returns the protocol version,
configured environment ID, per-process UUID, native platform, and capabilities.
Gateway validates the response against the configured environment and the exact
supported protocol schema before listing workspaces or invoking tools. Missing
capabilities, identity mismatch, malformed data, authentication failure, and protocol
incompatibility all fail closed and mark the Worker offline.

The handshake is cached only for the lifetime of a `WorkerClient`. Registry hot reload
constructs new clients and therefore requires a new handshake. A Worker restart also
changes its instance UUID.

## CI gates

`distribution-baseline.yml`:

- builds and packs the artifact on clean Ubuntu and Windows runners;
- installs the tarball without access to monorepo workspace packages;
- executes the installed CLI on both operating systems;
- starts the installed Gateway and Worker on Linux;
- verifies authenticated hello, Linux platform identity, protocol and capabilities;
- verifies the Gateway reports the handshaken Worker online;
- verifies unauthenticated handshake requests are rejected.

The existing adversarial gate remains required and includes protocol mismatch,
capability omission, environment identity mismatch, dependency audit, and Worker-side
authorization tests.

## Security boundary

Workers remain restricted to loopback HTTP in this baseline. The Worker token and
handshake authenticate processes on one host; they do not provide remote transport
confidentiality or replace mTLS. Cross-host enrollment and mutually authenticated
transport require a later baseline.
