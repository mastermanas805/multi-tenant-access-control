# Dev signing keypair — DO NOT USE IN PRODUCTION

`dev-private.pem` / `dev-public.pem` is a **2048-bit RSA keypair generated on
demand** (never committed — both files are git-ignored) so the identity service
boots and signs RS256 tokens out of the box with zero setup.

**Generate it** with `pnpm gen:keys` (run automatically in CI and before the
Docker build). It is regenerated as a matched pair if either file is missing, and
is safe ONLY for local development and CI — it protects nothing.

## Production

Inject your own keys and never commit them. Either:

- **File paths** (k8s/Docker secrets):
  `JWT_PRIVATE_KEY_PATH=/run/secrets/identity-private.pem`
  `JWT_PUBLIC_KEY_PATH=/run/secrets/identity-public.pem`
- **Inline PEM** (newlines escaped as `\n`):
  `JWT_PRIVATE_KEY=...`  `JWT_PUBLIC_KEY=...`

Set a distinct `JWT_SIGNING_KID` per key. To **rotate**: mint under a new `kid`
while still publishing the old public key in the JWKS until every token signed
with it has expired (≤ `ACCESS_TOKEN_TTL_SECONDS`).

## Regenerate the dev keypair

```sh
node -e "const c=require('crypto'),fs=require('fs');\
const {publicKey,privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});\
fs.writeFileSync('dev-private.pem',privateKey.export({type:'pkcs8',format:'pem'}));\
fs.writeFileSync('dev-public.pem',publicKey.export({type:'spki',format:'pem'}));"
```
