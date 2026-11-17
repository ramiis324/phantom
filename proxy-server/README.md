# RCDN Proxy — Deploy Guide

Run YouTube/TikTok/Instagram/etc. through a clean-IP proxy server so the sites
are never blocked as bots. Includes the full proxy browser UI.

## 1. Create an Oracle Cloud (Always Free) account

1. Go to https://signup.cloud.oracle.com
2. Fill in name, email, and a **real phone number** (they text a code).
3. Add a credit/debit card — **they do not charge it** unless you explicitly
   upgrade to paid. Free tier is truly free.
4. Create your account and Region (pick a region close to you; `sa-saopaulo-1`
   or `ap-tokyo-1` often have free ARM availability).

## 2. Launch a free VM

1. Oracle Cloud console → **Compute → Instances → Create instance**.
2. Name it whatever (e.g. `rcdn-proxy`).
3. **Image:** Ubuntu 22.04 (or 24.04).
4. **Shape:** Change to one of the **Ampere A1 (ARM)** shapes — pick the free
   tier (e.g. 2 OCPUs / 12 GB RAM). If it says "out of capacity", pick a shape
   in `Always Free eligible` or switch region.
5. **Networking:** keep defaults; note the public IP once created.
6. **Add SSH key:** download/save the private key, or add a public key.
7. **Create.** Wait ~2 min for it to boot.

> If no free shape is available, the **E2.1.Micro** (1/8 OCPU, 1GB) is also free
> and plenty for 50-150 users of a proxy.

## 3. Open the firewall / port 3000

In the Oracle console:
- **Networking → Virtual Cloud Networks → <your VCN> → Security Lists → Default
  Security List → Add Ingress Rules**.
- Rule: Source `0.0.0.0/0`, Protocol **TCP**, Destination port **3000**,
  Allow.

## 4. Connect and deploy

Open a terminal (Windows has OpenSSH built in):

```bash
ssh ubuntu@<SERVER_IP>
```

Upload these files (run from the folder with `server.js`, `deploy.sh`,
`package.json`):

```bash
scp -r /path/to/proxy-server ubuntu@<SERVER_IP>:/home/ubuntu/
```

Or copy-paste `deploy.sh`, `server.js`, `package.json` into a folder. Then:

```bash
cd proxy-server
sudo bash deploy.sh
```

That installs Node, installs deps, sets up a service that auto-restarts on
reboot, and starts the proxy on port 3000.

## 5. Use it

- Proxy UI: **http://<SERVER_IP>:3000/**
- Or plug it into your static front end — in `apps/index.html` set:

```js
var PROXY_URL = "http://<SERVER_IP>:3000";
```

## Pointing your static site at the VPS

Your existing static site hosts `apps/index.html`. Change only the `PROXY_URL`
line to your VPS. The iframe loads everything through the proxy. CORS is already
enabled (`access-control-allow-origin: *`).

## Useful commands

```bash
systemctl status rcdn-proxy     # status
journalctl -u rcdn-proxy -f     # live logs
systemctl restart rcdn-proxy    # restart
```

## Changing the default app

Edit `DEFAULT_TARGET` at the top of `server.js`, or set it at runtime:

```bash
DEFAULT_TARGET=https://www.instagram.com sudo -E node server.js
```

## The Cloudflare Worker (bot-flagged)

The older `proxy-worker/` still works and is deployed, but Cloudflare's egress
IPs get flagged by TikTok/Google. The Node.js server above egresses from your
VPS's clean IP, which is why TikTok/YouTube serve normal pages instead of bot
checks / crash pages.
