import { SERIES_NAME } from "@/lib/site";
import { formatCents, formatEventDate, formatTime } from "@/lib/time";

export type RaceLine = {
  eventName: string;
  eventDate: string;
  categoryName: string;
  startAt: string;
  status: "confirmed" | "pending_payment" | "waitlisted" | "canceled" | "refunded";
  amountPaidCents?: number | null;
  waitlistPosition?: number | null;
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:0 auto;padding:16px">
<p style="font-weight:bold;color:#0b4fa8;margin:0 0 8px">${esc(SERIES_NAME)}</p>
<h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>
${bodyHtml}
<p style="color:#475569;font-size:13px;margin-top:24px">Times are Eastern Time. Reply to this email with questions.</p>
</body></html>`;
}

function raceText(r: RaceLine): string {
  const when = `${formatEventDate(r.eventDate, "short")}, ${formatTime(r.startAt)}`;
  const status =
    r.status === "waitlisted"
      ? `Waitlist${r.waitlistPosition ? ` (position ${r.waitlistPosition})` : ""}`
      : r.status === "pending_payment"
        ? "Payment needed"
        : r.status === "confirmed"
          ? `Confirmed${r.amountPaidCents ? `, paid ${formatCents(r.amountPaidCents)}` : ""}`
          : r.status === "refunded"
            ? "Canceled and refunded"
            : "Canceled";
  return `${r.eventName}, ${r.categoryName}: ${when}. ${status}.`;
}

function raceList(races: RaceLine[]): { html: string; text: string } {
  return {
    html: `<ul style="padding-left:20px">${races.map((r) => `<li style="margin-bottom:6px">${esc(raceText(r))}</li>`).join("")}</ul>`,
    text: races.map((r) => `- ${raceText(r)}`).join("\n"),
  };
}

export function registrationEmail(firstName: string, races: RaceLine[], myRacesUrl: string) {
  const list = raceList(races);
  const anyWaitlist = races.some((r) => r.status === "waitlisted");
  const title = anyWaitlist && races.every((r) => r.status === "waitlisted") ? "You're on the waitlist" : "You're registered";
  const waitNote = anyWaitlist
    ? "If a spot opens in a waitlisted race, we'll email you right away."
    : "";
  return {
    subject: `${title}: ${races.map((r) => r.eventName).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`,
    html: layout(
      title,
      `<p>Hi ${esc(firstName)},</p>${list.html}${waitNote ? `<p>${esc(waitNote)}</p>` : ""}
<p>Check in at the registration desk on race day. Your check-in code is on <a href="${esc(myRacesUrl)}">My races</a>.</p>`,
    ),
    text: `Hi ${firstName},\n\n${list.text}\n\n${waitNote ? `${waitNote}\n\n` : ""}Check in at the registration desk on race day. Your check-in code is on My races: ${myRacesUrl}\n`,
  };
}

export function promotedEmail(firstName: string, race: RaceLine, payUrl: string, offerHours: number) {
  const needsPayment = race.status === "pending_payment";
  const title = "A spot opened up for you";
  const action = needsPayment
    ? `Pay within ${offerHours} hours to keep the spot. After that, it goes to the next rider on the waitlist.`
    : "You're confirmed. No action needed.";
  return {
    subject: `${title}: ${race.eventName}, ${race.categoryName}`,
    html: layout(
      title,
      `<p>Hi ${esc(firstName)},</p><p>${esc(raceText({ ...race, status: needsPayment ? "pending_payment" : "confirmed" }))}</p><p>${esc(action)}</p>
${needsPayment ? `<p><a href="${esc(payUrl)}" style="display:inline-block;background:#0b4fa8;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:bold">Pay and confirm</a></p>` : ""}`,
    ),
    text: `Hi ${firstName},\n\n${raceText(race)}\n\n${action}${needsPayment ? `\n\nPay here: ${payUrl}` : ""}\n`,
  };
}

export function waiverEmail(firstName: string, waiverTitle: string, versionNumber: number) {
  const title = "Your signed waiver";
  return {
    subject: `Your signed waiver: ${waiverTitle} (version ${versionNumber})`,
    html: layout(
      title,
      `<p>Hi ${esc(firstName)},</p><p>Thanks for signing. A PDF copy of the waiver and your signature details is attached. Keep it for your records.</p>`,
    ),
    text: `Hi ${firstName},\n\nThanks for signing. A PDF copy of the waiver and your signature details is attached. Keep it for your records.\n`,
  };
}

export function seasonPassEmail(firstName: string, categories: string[], registeredCount: number, myRacesUrl: string) {
  const title = "Your season pass is active";
  const body = `You're registered for ${registeredCount} ${registeredCount === 1 ? "race" : "races"} in ${categories.join(", ")}. Races added later in the season are added to your registrations automatically.`;
  return {
    subject: title,
    html: layout(title, `<p>Hi ${esc(firstName)},</p><p>${esc(body)}</p><p><a href="${esc(myRacesUrl)}">See My races</a></p>`),
    text: `Hi ${firstName},\n\n${body}\n\nMy races: ${myRacesUrl}\n`,
  };
}

export function cancellationEmail(firstName: string, race: RaceLine, refundNote: string) {
  const title = "Registration canceled";
  return {
    subject: `${title}: ${race.eventName}, ${race.categoryName}`,
    html: layout(title, `<p>Hi ${esc(firstName)},</p><p>${esc(raceText(race))}</p><p>${esc(refundNote)}</p>`),
    text: `Hi ${firstName},\n\n${raceText(race)}\n\n${refundNote}\n`,
  };
}

export function announcementEmail(firstName: string, title: string, bodyText: string, url: string, urgent: boolean) {
  const subject = urgent ? `Urgent: ${title}` : title;
  const paragraphs = bodyText.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return {
    subject,
    html: layout(title, `<p>Hi ${esc(firstName)},</p>${paragraphs}<p><a href="${esc(url)}">Read it on the series site</a></p>
<p style="color:#475569;font-size:13px">You're getting this because you're registered for the Conestee Crit Series.</p>`),
    text: `Hi ${firstName},\n\n${bodyText}\n\nRead it on the series site: ${url}\n\nYou're getting this because you're registered for the Conestee Crit Series.\n`,
  };
}
