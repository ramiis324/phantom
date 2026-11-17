// wisp TCP relay: one WebSocket per TCP stream.
// Protocol: client upgrades to /<secret>/ws?host=<h>&port=<p>
//   <- first message is text "OK" (connected) or "ERR <reason>" (failed)
//   <-> after that all messages are raw binary TCP bytes in both directions.
import { connect } from "cloudflare:sockets";

export default {
	async fetch(request, env) {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("wisp tcp relay: use ws", { status: 426 });
		}
		const url = new URL(request.url);
		const token = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
		if (!env.WISP_SECRET || token !== env.WISP_SECRET) {
			return new Response("forbidden", { status: 403 });
		}
		const host = url.searchParams.get("host") || "";
		const port = Number(url.searchParams.get("port") || 0);
		if (!/^[a-zA-Z0-9.\-]{1,120}$/.test(host) || !(port >= 1 && port <= 65535)) {
			return new Response("bad host/port", { status: 400 });
		}

		let tcp;
		try {
			tcp = connect(
				`${host}:${port}`,
				{ secureTransport: port === 443 ? "starttls" : "off" },
			);
			await tcp.opened;
		} catch (e) {
			const pair = new WebSocketPair();
			const server = pair[1];
			server.accept();
			server.send("ERR " + (e.message || e.toString()));
			return new Response(null, { status: 101, webSocket: pair[0] });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();
		server.send("OK");

		server.addEventListener("message", async (e) => {
			try {
				if (e.data instanceof ArrayBuffer) {
					const w = tcp.writable.getWriter();
					await w.write(new Uint8Array(e.data));
					w.releaseLock();
				}
			} catch {
				try { server.close(1000); } catch {}
			}
		});
		server.addEventListener("close", () => {
			try { tcp.close(); } catch {}
		});

		// socket -> client
		(async () => {
			try {
				const reader = tcp.readable.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					server.send(value);
				}
				try { server.close(1000); } catch {}
			} catch {
				try { server.close(1011); } catch {}
			}
		})();

		return new Response(null, { status: 101, webSocket: client });
	},
};
