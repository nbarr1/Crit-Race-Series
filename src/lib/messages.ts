/**
 * Turns the stable codes that the database functions return into sentences
 * for riders and staff.
 */

const CATEGORY_NAME: Record<string, string> = { woman: "women" };

export function describeWarning(code: string): string {
  const [kind, arg] = code.split(":");
  switch (kind) {
    case "min_age":
      return `This category is for riders who turn ${arg} or older this year. Staff may ask you to race another category.`;
    case "min_age_unknown":
      return "This category has a minimum age, and your profile has no birth date.";
    case "gender":
      return `This category is for ${CATEGORY_NAME[arg] ?? arg}. Staff may ask you to race another category.`;
    case "gender_unspecified":
      return `This category is for ${CATEGORY_NAME[arg] ?? arg}, and your profile doesn't say. Staff may check at the desk.`;
    case "license_expired":
      return "Your USA Cycling license on file expires before race day.";
    default:
      return "Staff will check your eligibility for this category.";
  }
}

const ERRORS: Record<string, string> = {
  not_signed_in: "Sign in to register.",
  profile_missing: "We couldn't find your rider profile. Sign out and sign in again.",
  profile_incomplete: "Finish your rider profile before you register.",
  event_not_open: "One of the races you picked isn't open for registration.",
  registration_closed: "Online registration has closed for one of the races you picked. Register at the desk on race day.",
  already_registered: "You're already registered for one of the races you picked.",
  eligibility_warnings: "Read the eligibility notes and confirm before you continue.",
  no_current_waiver: "The organizers haven't published this season's waiver yet. Check back soon.",
  waiver_required: "Sign this season's waiver before you register.",
  license_required: "Add your USA Cycling license number to your profile before you register.",
  minors_not_allowed: "Riders under 18 can't register for this series.",
  nothing_selected: "Pick at least one race.",
  too_many_selected: "Pick 20 or fewer races at a time.",
  not_cancelable: "That registration can't be canceled.",
  already_checked_in: "You've already checked in, so this registration can't be canceled online. Talk to the desk.",
  not_found: "We couldn't find that registration.",
  season_not_open: "Season passes aren't on sale.",
  season_pass_unavailable: "Season passes aren't available online.",
  // Staff (check-in desk)
  staff_only: "Only race staff can do that. Sign in with a staff account.",
  bib_required: "Enter a bib number.",
  bib_taken: "That bib number is already assigned to another rider at this event.",
  bib_invalid: "Bib numbers are whole numbers from 1 to 99999.",
  not_confirmed: "This rider isn't confirmed yet. Record their payment first.",
  payment_method_invalid: "Pick cash, card at the desk, Stripe link, or comp.",
  amount_invalid: "Enter an amount between $0 and $1,000.",
  already_paid: "This rider already paid online.",
  reason_required: "Enter a reason for the override.",
  waiver_changed: "A new waiver version was published. Reload the roster and have the rider sign the new version.",
  guardian_required: "This rider is under 18. A parent or guardian must sign too.",
  walk_up_details_required: "Enter the rider's first and last name, birth date, and an emergency contact name and phone.",
  not_checked_in: "That rider isn't checked in.",
};

/** Maps a Postgres error message (a code raised by our functions) to text. */
export function describeError(message: string | undefined | null): string {
  const code = (message ?? "").trim();
  return ERRORS[code] ?? "Something went wrong. Try again, or ask at the registration desk.";
}

export function errorCode(message: string | undefined | null): string {
  const code = (message ?? "").trim();
  return code in ERRORS ? code : "unknown";
}
