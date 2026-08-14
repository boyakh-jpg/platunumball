import { handleRecordList } from "./list.js";

export default async function handler(request, response) {
  return handleRecordList(request, response, { publicRead: true });
}
