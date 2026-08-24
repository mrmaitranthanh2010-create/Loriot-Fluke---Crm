const LORIOT_LOGO_BASE64 = "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";

export const LORIOT_LOGO_DATA_URL = `data:image/png;base64,${LORIOT_LOGO_BASE64}`;
export const LORIOT_LOGO_CONTENT_ID = "loriot-logo";

export const LORIOT_SIGNATURE_TEXT = `Thanks and best regards,
----------------------------------------------------------------------------------------
Mai Trần Thành (Mr.)
T: (+84) 964 72 72 33
E: hn.sales3@loriot.com.vn`;

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

export const stripKnownEmailSignature = (value: string) => value
  .replace(/\n{1,3}Trân trọng,?\s*\nMai Trần Thành\s*\nLoriot Industrial\s*$/i, "")
  .replace(/\n{1,3}Thanks and best regards,?\s*\n-{8,}\s*\nMai Trần Thành \(Mr\.\)\s*\nT:\s*\(\+84\) 964 72 72 33\s*\nE:\s*hn\.sales3@loriot\.com\.vn\s*$/i, "")
  .trim();

const bodyHtml = (value: string) => escapeHtml(stripKnownEmailSignature(value))
  .split(/\n{2,}/)
  .map((paragraph) => `<p style="margin:0 0 14px;">${paragraph.replace(/\n/g, "<br>")}</p>`)
  .join("");

export const loriotEmailContent = (body: string) => {
  const cleanBody = stripKnownEmailSignature(body);
  return {
    text: `${cleanBody}\n\n${LORIOT_SIGNATURE_TEXT}`,
    html: `<div style="max-width:640px;color:#202938;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">${bodyHtml(cleanBody)}<div style="margin-top:24px;color:#1d2736;"><div style="margin-bottom:8px;">Thanks and best regards,</div><div style="width:100%;max-width:520px;border-top:1px solid #b8bdc6;margin:0 0 10px;"></div><div style="font-weight:700;">Mai Trần Thành (Mr.)</div><div><strong>T:</strong> (+84) 964 72 72 33</div><div><strong>E:</strong> <a href="mailto:hn.sales3@loriot.com.vn" style="color:#1b43d8;text-decoration:none;">hn.sales3@loriot.com.vn</a></div><img src="cid:${LORIOT_LOGO_CONTENT_ID}" width="225" height="47" alt="Loriot Industrial" style="display:block;width:225px;height:auto;margin-top:14px;border:0;"></div></div>`,
    inlineImages: [{
      contentId: LORIOT_LOGO_CONTENT_ID,
      filename: "loriot-logo.png",
      contentType: "image/png",
      contentBase64: LORIOT_LOGO_BASE64,
    }],
  };
};
