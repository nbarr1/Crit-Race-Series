import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { waiverEmail } from "@/lib/email/templates";
import { buildWaiverPdf } from "@/lib/waiver-pdf";
import { SERIES_NAME } from "@/lib/site";

export const WAIVER_BUCKET = "waivers";

export type SignatureInput = {
  riderId: string;
  waiverVersionId: string;
  typedFullName: string;
  ipAddress: string | null;
  userAgent: string | null;
  guardian: { name: string; relationship: string; typedSignature: string } | null;
};

/**
 * Records a rider's own signature. The caller must have verified the session
 * and that riderId is the signed-in rider's profile (D-022).
 */
export async function recordSignature(input: SignatureInput): Promise<string> {
  const admin = createAdminClient();
  const ip = input.ipAddress && input.ipAddress !== "unknown" ? input.ipAddress : null;
  const { data, error } = await admin
    .from("waiver_signatures")
    .insert({
      rider_id: input.riderId,
      waiver_version_id: input.waiverVersionId,
      typed_full_name: input.typedFullName,
      agreed: true,
      ip_address: ip,
      user_agent: input.userAgent,
      guardian_name: input.guardian?.name ?? null,
      guardian_relationship: input.guardian?.relationship ?? null,
      guardian_typed_signature: input.guardian?.typedSignature ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`record signature: ${error.message}`);
  return (data as { id: string }).id;
}

type SignatureRow = {
  id: string;
  rider_id: string;
  typed_full_name: string;
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_typed_signature: string | null;
  pdf_path: string | null;
  email_sent_at: string | null;
  waiver_versions: { title: string; version_number: number; body_markdown: string };
  rider: { first_name: string; last_name: string; birth_date: string | null; email: string | null };
  collector: { first_name: string; last_name: string } | null;
};

/**
 * Generates and stores the PDF (once) and emails it to the rider (once).
 * Safe to retry: the scheduled job calls it for any signature missing either.
 */
export async function finalizeSignature(signatureId: string): Promise<{ pdf: boolean; emailed: boolean }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("waiver_signatures")
    .select(
      "id, rider_id, typed_full_name, signed_at, ip_address, user_agent, guardian_name, guardian_relationship, guardian_typed_signature, pdf_path, email_sent_at, waiver_versions(title, version_number, body_markdown), rider:profiles!waiver_signatures_rider_id_fkey(first_name, last_name, birth_date, email), collector:profiles!waiver_signatures_collected_by_fkey(first_name, last_name)",
    )
    .eq("id", signatureId)
    .single();
  if (error || !data) throw new Error(`load signature: ${error?.message ?? "not found"}`);
  const sig = data as unknown as SignatureRow;

  let pdfBytes: Uint8Array | null = null;
  let path = sig.pdf_path;
  if (!path) {
    pdfBytes = await buildWaiverPdf({
      seriesName: SERIES_NAME,
      waiverTitle: sig.waiver_versions.title,
      versionNumber: sig.waiver_versions.version_number,
      bodyMarkdown: sig.waiver_versions.body_markdown,
      riderName: `${sig.rider.first_name} ${sig.rider.last_name}`.trim(),
      riderBirthDate: sig.rider.birth_date,
      typedFullName: sig.typed_full_name,
      signedAt: sig.signed_at,
      ipAddress: sig.ip_address,
      userAgent: sig.user_agent,
      signatureId: sig.id,
      guardian: sig.guardian_name
        ? {
            name: sig.guardian_name,
            relationship: sig.guardian_relationship ?? "",
            typedSignature: sig.guardian_typed_signature ?? "",
          }
        : null,
      collectedBy: sig.collector ? `${sig.collector.first_name} ${sig.collector.last_name}`.trim() : null,
    });
    path = `${sig.rider_id}/${sig.id}.pdf`;
    const upload = await admin.storage
      .from(WAIVER_BUCKET)
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw new Error(`upload waiver pdf: ${upload.error.message}`);
    const { error: updateError } = await admin.from("waiver_signatures").update({ pdf_path: path }).eq("id", sig.id);
    if (updateError) throw new Error(`save pdf path: ${updateError.message}`);
  }

  let emailed = Boolean(sig.email_sent_at);
  if (!emailed && sig.rider.email) {
    if (!pdfBytes) {
      const download = await admin.storage.from(WAIVER_BUCKET).download(path);
      if (download.error) throw new Error(`download waiver pdf: ${download.error.message}`);
      pdfBytes = new Uint8Array(await download.data.arrayBuffer());
    }
    const msg = waiverEmail(sig.rider.first_name || "rider", sig.waiver_versions.title, sig.waiver_versions.version_number);
    emailed = await sendEmail({
      to: sig.rider.email,
      ...msg,
      attachments: [{ filename: `waiver-v${sig.waiver_versions.version_number}.pdf`, content: pdfBytes }],
      idempotencyKey: `waiver/${sig.id}`,
    });
    if (emailed) {
      await admin.from("waiver_signatures").update({ email_sent_at: new Date().toISOString() }).eq("id", sig.id);
    }
  }
  return { pdf: true, emailed };
}

/** A short-lived download link for a stored waiver PDF. */
export async function signedPdfUrl(path: string, seconds = 300): Promise<string | null> {
  const { data } = await createAdminClient().storage.from(WAIVER_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}
