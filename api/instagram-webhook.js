import instagramWebhook from "../server/api/instagram/webhook.js";
import { enforceApiRouteSecurity } from "../server/api/_requestSecurity.js";

const INSTAGRAM_WEBHOOK_ROUTE = Object.freeze({
  methods: Object.freeze(["GET", "POST"]),
  auth: "signedWebhook",
  allowedSensitiveQueryKeysByMethod: Object.freeze({ GET: Object.freeze(["hub.verify_token", "hub_verify_token"]) }),
});

export const config = Object.freeze({ api: Object.freeze({ bodyParser: false }) });

export default function handler(request, response) {
  if (!enforceApiRouteSecurity(request, response, INSTAGRAM_WEBHOOK_ROUTE)) return;
  request.rankballRoutePath = "/instagram/webhook";
  return instagramWebhook(request, response);
}
