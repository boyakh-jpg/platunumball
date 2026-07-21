import { createHash } from "node:crypto";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const IMPORT_RPC = "rankball_import_public_courts";
const MAX_RPC_BATCH_SIZE = 50;

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function loadEnvText(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadEnvFile(path) {
  if (!path) return;
  loadEnvText(await readFile(resolve(path), "utf8"));
}

function getSupabaseConfig() {
  const url = cleanText(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, "");
  const serviceRoleKey = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url) throw new Error("supabase_url_missing");
  if (!serviceRoleKey) throw new Error("supabase_service_role_key_missing");
  return { url, serviceRoleKey };
}

function normalizeIdentityText(value) {
  return cleanText(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function haversineMeters(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const radians = (value) => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
}

function sameLocation(a, b) {
  const aAddresses = [a?.addressText, a?.roadAddress, a?.jibunAddress].map(normalizeIdentityText).filter(Boolean);
  const bAddresses = new Set([b?.addressText, b?.roadAddress, b?.jibunAddress].map(normalizeIdentityText).filter(Boolean));
  return aAddresses.some((address) => bAddresses.has(address)) || haversineMeters(a, b) <= 35;
}

function pushRowError(rowErrors, row, code, details = {}) {
  const rowNumber = Number(row?.rowNumber) || null;
  const courtId = cleanText(row?.court?.id) || null;
  rowErrors.push({ rowNumber, courtId, code, ...details });
}

export function validateNormalizedImport(document) {
  const fatalErrors = [];
  const rowErrors = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) fatalErrors.push("document_must_be_object");
  if (document?.schemaVersion !== 1) fatalErrors.push("unsupported_schema_version");
  if (!/^public-courts-[0-9a-f]{16}$/.test(cleanText(document?.batchId))) fatalErrors.push("invalid_batch_id");
  if (!/^[0-9a-f]{64}$/.test(cleanText(document?.source?.sha256))) fatalErrors.push("invalid_source_sha256");
  if (!Array.isArray(document?.rows)) fatalErrors.push("rows_must_be_array");
  if (fatalErrors.length) return { fatalErrors, rowErrors, readyRows: [], blockedRows: [] };

  const rows = document.rows;
  const readyRows = rows.filter((row) => row?.disposition === "ready");
  const blockedRows = rows.filter((row) => row?.disposition !== "ready");
  const idOwners = new Map();
  const rowNumberOwners = new Map();
  const readyHashtagOwners = new Map();
  const readyImportKeyOwners = new Map();
  const readySourceOwners = new Map();

  for (const row of rows) {
    const court = row?.court ?? {};
    const courtId = cleanText(court.id);
    const rowNumber = Number(row?.rowNumber);
    if (!courtId) pushRowError(rowErrors, row, "court_id_missing");
    if (!Number.isInteger(rowNumber) || rowNumber < 2) pushRowError(rowErrors, row, "invalid_row_number");
    if (courtId && idOwners.has(courtId)) pushRowError(rowErrors, row, "duplicate_court_id", { otherRowNumber: idOwners.get(courtId) });
    else if (courtId) idOwners.set(courtId, rowNumber);
    if (Number.isInteger(rowNumber) && rowNumberOwners.has(rowNumber)) pushRowError(rowErrors, row, "duplicate_row_number");
    else if (Number.isInteger(rowNumber)) rowNumberOwners.set(rowNumber, courtId);

    if (row?.disposition !== "ready") continue;
    const importKey = cleanText(row.importKey);
    const hashtag = cleanText(court.hashtag).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(importKey)) pushRowError(rowErrors, row, "invalid_import_key");
    if (!/^#[0-9]{5}$/.test(hashtag)) pushRowError(rowErrors, row, "invalid_hashtag");
    if (!cleanText(court.name) || !cleanText(court.addressText)) pushRowError(rowErrors, row, "required_court_field_missing");
    if (!Number.isFinite(Number(court.lat)) || !Number.isFinite(Number(court.lng))) pushRowError(rowErrors, row, "coordinate_missing");
    if (court.addressSource !== "naver_reverse_geocode" || court.geocodeVerified !== true) pushRowError(rowErrors, row, "reverse_geocode_required");
    if (!["source_verified", "verified"].includes(court.verificationStatus) || !cleanText(court.verifiedAt)) pushRowError(rowErrors, row, "verification_required");
    if (!Array.isArray(row.sources) || row.sources.length === 0) pushRowError(rowErrors, row, "source_record_required");

    if (readyHashtagOwners.has(hashtag)) pushRowError(rowErrors, row, "duplicate_hashtag", { otherCourtId: readyHashtagOwners.get(hashtag) });
    else readyHashtagOwners.set(hashtag, courtId);
    if (readyImportKeyOwners.has(importKey)) pushRowError(rowErrors, row, "duplicate_import_key", { otherCourtId: readyImportKeyOwners.get(importKey) });
    else readyImportKeyOwners.set(importKey, courtId);

    for (const source of row.sources ?? []) {
      const sourceKey = `${cleanText(source?.provider)}|${cleanText(source?.sourceRecordId)}`;
      if (sourceKey === "|") {
        pushRowError(rowErrors, row, "invalid_source_record");
      } else if (readySourceOwners.has(sourceKey) && readySourceOwners.get(sourceKey) !== courtId) {
        pushRowError(rowErrors, row, "duplicate_source_record", { otherCourtId: readySourceOwners.get(sourceKey), sourceKey });
      } else {
        readySourceOwners.set(sourceKey, courtId);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < readyRows.length; leftIndex += 1) {
    const left = readyRows[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < readyRows.length; rightIndex += 1) {
      const right = readyRows[rightIndex];
      if (!sameLocation(left.court, right.court)) continue;
      const sameName = normalizeIdentityText(left.court?.name) === normalizeIdentityText(right.court?.name);
      const leftVerifiedUnit = Boolean(cleanText(left.court?.courtUnit)) && left.court?.multipleCourtsVerified === true;
      const rightVerifiedUnit = Boolean(cleanText(right.court?.courtUnit)) && right.court?.multipleCourtsVerified === true;
      if (sameName || !leftVerifiedUnit || !rightVerifiedUnit) {
        pushRowError(rowErrors, right, sameName ? "duplicate_ready_court" : "shared_location_review_required", {
          otherCourtId: cleanText(left.court?.id),
          distanceM: Math.round(haversineMeters(left.court, right.court) * 10) / 10,
        });
      }
    }
  }

  const invalidReadyIds = new Set(rowErrors.filter((error) => readyRows.some((row) => row.rowNumber === error.rowNumber)).map((error) => error.courtId));
  return {
    fatalErrors,
    rowErrors,
    readyRows: readyRows.filter((row) => !invalidReadyIds.has(cleanText(row.court?.id))),
    blockedRows,
    declaredReadyRows: readyRows,
  };
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function callImportRpc(config, payload) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${IMPORT_RPC}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(cleanText(body?.message || body?.error || `court_import_rpc_http_${response.status}`));
    error.code = cleanText(body?.code || `http_${response.status}`);
    throw error;
  }
  return body;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function run() {
  const inputArg = getArg("input");
  if (!inputArg) throw new Error("input_required");
  await loadEnvFile(getArg("env-file"));
  const inputPath = resolve(inputArg);
  const document = JSON.parse(await readFile(inputPath, "utf8"));
  const validation = validateNormalizedImport(document);
  const remotePreview = hasFlag("remote-preview") || hasFlag("apply");
  const apply = hasFlag("apply");
  const requestedBatchSize = Number(getArg("batch-size", "25"));
  const batchSize = Number.isInteger(requestedBatchSize) && requestedBatchSize >= 1 && requestedBatchSize <= MAX_RPC_BATCH_SIZE
    ? requestedBatchSize
    : 25;
  const reportPath = resolve(getArg("report", `${inputPath}.dry-run.json`));
  const sourceFile = [document?.source?.archiveFileName, document?.source?.sheetName].filter(Boolean).join("#");
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    mode: apply ? "apply" : remotePreview ? "remote-preview" : "local-dry-run",
    inputPath,
    inputSha256: createHash("sha256").update(await readFile(inputPath)).digest("hex"),
    batchId: document.batchId,
    source: document.source,
    startedAt,
    summary: {
      totalRows: document.rows?.length ?? 0,
      declaredReadyRows: validation.declaredReadyRows?.length ?? 0,
      locallyValidReadyRows: validation.readyRows.length,
      blockedByNormalizer: validation.blockedRows.length,
      localValidationErrors: validation.rowErrors.length,
      fatalErrors: validation.fatalErrors.length,
      remoteReadyRows: 0,
      remoteBlockedRows: 0,
      appliedRows: 0,
    },
    fatalErrors: validation.fatalErrors,
    localErrors: validation.rowErrors,
    remoteBatches: [],
  };

  if (validation.fatalErrors.length) {
    report.completedAt = new Date().toISOString();
    await writeJson(reportPath, report);
    throw new Error(`local_import_document_invalid:${validation.fatalErrors.join(",")}`);
  }

  if (remotePreview) {
    if (!validation.readyRows.length) {
      report.completedAt = new Date().toISOString();
      await writeJson(reportPath, report);
      throw new Error("no_locally_ready_rows_for_remote_preview");
    }
    if (validation.rowErrors.length) {
      report.completedAt = new Date().toISOString();
      await writeJson(reportPath, report);
      throw new Error("local_ready_row_validation_failed");
    }

    const config = getSupabaseConfig();
    const chunks = chunkRows(validation.readyRows, batchSize);
    for (let index = 0; index < chunks.length; index += 1) {
      const partId = `${document.batchId}-part-${String(index + 1).padStart(4, "0")}`;
      const preview = await callImportRpc(config, {
        p_batch_id: partId,
        p_source_file: sourceFile,
        p_source_sha256: document.source.sha256,
        p_rows: chunks[index],
        p_apply: false,
      });
      report.remoteBatches.push({ partId, mode: "preview", result: preview });
      report.summary.remoteReadyRows += Number(preview?.readyCount ?? 0);
      report.summary.remoteBlockedRows += Number(preview?.blockedCount ?? 0);
    }

    if (report.summary.remoteBlockedRows > 0 || report.summary.remoteReadyRows !== validation.readyRows.length) {
      report.completedAt = new Date().toISOString();
      await writeJson(reportPath, report);
      throw new Error("remote_preview_blocked_rows");
    }

    if (apply) {
      const confirmation = getArg("confirm");
      if (confirmation !== document.batchId) {
        report.completedAt = new Date().toISOString();
        await writeJson(reportPath, report);
        throw new Error(`apply_confirmation_required:--confirm=${document.batchId}`);
      }
      for (let index = 0; index < chunks.length; index += 1) {
        const partId = `${document.batchId}-part-${String(index + 1).padStart(4, "0")}`;
        const applied = await callImportRpc(config, {
          p_batch_id: partId,
          p_source_file: sourceFile,
          p_source_sha256: document.source.sha256,
          p_rows: chunks[index],
          p_apply: true,
        });
        report.remoteBatches.push({ partId, mode: "apply", result: applied });
        report.summary.appliedRows += Number(applied?.appliedCount ?? 0);
        await writeJson(reportPath, { ...report, updatedAt: new Date().toISOString() });
      }
    }
  }

  report.completedAt = new Date().toISOString();
  await writeJson(reportPath, report);
  process.stdout.write(`${JSON.stringify({ report: reportPath, mode: report.mode, summary: report.summary })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`public_court_import_failed:${error.code ? `${error.code}:` : ""}${error.message}\n`);
    process.exitCode = 1;
  });
}
