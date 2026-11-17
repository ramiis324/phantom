/*
 * smtp-check.mjs — diagnostic only, safe to delete.
 *
 * Talks to a mail provider exactly the way Supabase does: connect, STARTTLS
 * (or implicit TLS on 465), AUTH LOGIN, then MAIL FROM with the sender
 * address you use in Supabase. Prints every server reply, so the reason a
 * send is refused becomes visible instead of a generic 500.
 *
 * The password is read from smtp-key.txt next to this file and is never
 * printed. Usage:
 *
 *   node smtp-check.mjs <host> <port> <smtp-username> <from-address> [to-address]
 *
 * Example:
 *   node smtp-check.mjs smtp-relay.brevo.com 587 you@smtp-brevo.com no-reply@example.com you@gmail.com
 */

import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";

const [host, portArg, user, from, to] = process.argv.slice(2);
const port = Number(portArg || 587);
const rcpt = to || from;

if (!host || !user || !from) {
  console.error("usage: node smtp-check.mjs <host> <port> <username> <from-address> [to-address]");
  process.exit(1);
}

const keyFile = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "smtp-key.txt");
let secret;
try {
  secret = fs.readFileSync(keyFile, "utf8").trim();
} catch (e) {
  console.error("Could not read smtp-key.txt next to this script. Put ONLY the SMTP password in it.");
  process.exit(1);
}
if (!secret) {
  console.error("smtp-key.txt is empty.");
  process.exit(1);
}

/* A tiny line-oriented SMTP client: write a command, read the full reply
   (multi-line replies start "250-" and end "250 "), hand back the text. */
function makeClient(socket) {
  let buffer = "";
  let pending = null;
  const waiters = [];

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    drain();
  });

  function drain() {
    if (!pending) return;
    const lines = buffer.split(/\r?\n/);
    // A reply is complete when the last full line looks like "NNN <text>".
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\d{3})([ -])(.*)$/.exec(lines[i]);
      if (m && m[2] === " ") {
        const reply = lines.slice(0, i + 1).join("\n");
        buffer = lines.slice(i + 1).join("\n");
        const p = pending;
        pending = null;
        p.resolve(reply);
        pending = waiters.shift() || null;
        if (pending) drain();
        return;
      }
    }
  }

  function next() {
    return new Promise((resolve, reject) => {
      if (pending) waiters.push({ resolve, reject });
      else pending = { resolve, reject };
      drain();
    });
  }

  async function cmd(line, label) {
    const shown = label || line.replace(/^AUTH LOGIN .*/, "AUTH LOGIN <redacted>");
    process.stdout.write("C: " + shown + "\n");
    if (line !== null) socket.write(line + "\r\n");
    const reply = await next();
    process.stdout.write("S: " + reply.trim().split("\n").join("\nS: ") + "\n\n");
    return reply;
  }

  return { cmd, next };
}

function connect(opts) {
  return new Promise((resolve, reject) => {
    const sock = opts.tls
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host }, () => resolve(sock))
      : net.connect({ host: opts.host, port: opts.port }, () => resolve(sock));
    sock.on("error", reject);
    sock.setTimeout(15000, () => reject(new Error("timeout waiting for the server")));
  });
}

async function main() {
  console.log(`\n== connecting to ${host}:${port} (${port === 465 ? "implicit TLS" : "STARTTLS"}) ==\n`);
  let socket = await connect({ host, port, tls: port === 465 });
  let c = makeClient(socket);

  await c.next().then((r) => console.log("S: " + r.trim() + "\n"));

  await c.cmd("EHLO phantom-check.local");

  if (port !== 465) {
    const starttls = await c.cmd("STARTTLS");
    if (!/^220/.test(starttls)) {
      console.log("Server refused STARTTLS — Supabase would fail here too.");
      process.exit(2);
    }
    socket = await new Promise((resolve, reject) => {
      const secure = tls.connect({ socket, servername: host }, () => resolve(secure));
      secure.on("error", reject);
    });
    c = makeClient(socket);
    await c.cmd("EHLO phantom-check.local");
  }

  const auth = await c.cmd("AUTH LOGIN");
  if (!/^334/.test(auth)) {
    console.log("Server did not offer AUTH LOGIN — check the port and that SMTP is enabled on the account.");
    process.exit(2);
  }
  await c.cmd(Buffer.from(user).toString("base64"), "AUTH username <" + user + ">");
  const authRes = await c.cmd(Buffer.from(secret).toString("base64"), "AUTH password <redacted>");
  if (!/^235/.test(authRes)) {
    console.log(">>> CREDENTIALS REJECTED. The password must be the provider's SMTP key, not its API key.");
    process.exit(3);
  }
  console.log(">>> credentials accepted\n");

  await c.cmd('MAIL FROM:<' + from + '>');
  const rcptRes = await c.cmd('RCPT TO:<' + rcpt + '>');
  if (!/^2\d\d/.test(rcptRes)) {
    console.log(">>> RECIPIENT REJECTED for " + rcpt);
  }
  await c.cmd("QUIT");
}

main().catch((e) => {
  console.error("FAILED: " + (e && e.message ? e.message : e));
  console.error("A connection error here means host/port/encryption is wrong; an auth error above means the key is wrong.");
  process.exit(1);
});
