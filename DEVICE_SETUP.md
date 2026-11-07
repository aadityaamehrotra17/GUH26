# Pear Setup — New Device (Mac)

Get Pear installed and ready for peer-to-peer communication.
You already have the repo — this is just the runtime setup.

---

## Step 1 — Install Node.js

Check if you already have it:

```sh
node --version
```

If not installed, download from [nodejs.org](https://nodejs.org) (LTS version).
npm comes bundled with it.

---

## Step 2 — Install Pear

```sh
npm i -g pear
```

Then run `pear` once to let it bootstrap itself from the peer network (~10–30 seconds):

```sh
pear -v
```

When ready it prints something like:

```
pear://0.0.smw4... / v3.6.0
```

---

## Step 3 — Install Bare runtime

Bare is the runtime engine that Pear apps run on:

```sh
npm i -g bare-runtime
```

Verify:

```sh
bare --version
# expected: v1.36.0 or higher
```

---

## Step 4 — Confirm you're ready

```sh
pear versions
```

If this prints version info without errors, you're good. The P2P stack is live and both devices can start communicating once the connection code is written.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `pear` not found after install | Open a **new** terminal window so PATH updates take effect |
| `pear -v` hangs | You may be behind a firewall — try on a regular Wi-Fi network first |
| `bare` not found after install | Same — open a new terminal |
