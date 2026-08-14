import { handleMatchDetail } from "./detail.js";

export default function handler(request, response) {
  return handleMatchDetail(request, response, { publicRead: true });
}
