import { isIP } from "node:net";

function readHeader(request, name) {
  const value = request?.headers?.[name] ?? request?.headers?.get?.(name) ?? "";
  return String(Array.isArray(value) ? value[0] : value).split(",")[0].trim();
}

function normalizeIpv4(value) {
  const parts = value.split(".").map(Number);
  return `ipv4:${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function expandIpv6(value) {
  const [left = "", right = ""] = value.toLowerCase().split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  return [...leftParts, ...Array(Math.max(0, 8 - leftParts.length - rightParts.length)).fill("0"), ...rightParts]
    .map((part) => part.padStart(4, "0"));
}

export function getRequestNetworkIdentity(request) {
  let address = readHeader(request, "x-vercel-forwarded-for")
    || readHeader(request, "x-forwarded-for")
    || readHeader(request, "x-real-ip");
  address = address.replace(/^\[|\]$/g, "").split("%")[0];
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return normalizeIpv4(mappedIpv4);
  if (isIP(address) === 4) return normalizeIpv4(address);
  if (isIP(address) === 6) return `ipv6:${expandIpv6(address).slice(0, 4).join(":")}/64`;
  return "network:unknown";
}
