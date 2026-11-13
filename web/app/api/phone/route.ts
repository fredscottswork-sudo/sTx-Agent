import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { PhoneReport } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 15;

const COUNTRY_NAMES: Record<string, string> = {
  UG: "Uganda", KE: "Kenya", TZ: "Tanzania", RW: "Rwanda", NG: "Nigeria", GH: "Ghana",
  ZA: "South Africa", EG: "Egypt", ET: "Ethiopia", MA: "Morocco",
  US: "United States", CA: "Canada", GB: "United Kingdom", IE: "Ireland",
  DE: "Germany", FR: "France", ES: "Spain", PT: "Portugal", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", CH: "Switzerland", AT: "Austria", SE: "Sweden",
  NO: "Norway", DK: "Denmark", FI: "Finland", IS: "Iceland", PL: "Poland",
  CZ: "Czechia", SK: "Slovakia", HU: "Hungary", RO: "Romania", BG: "Bulgaria",
  GR: "Greece", TR: "Türkiye", UA: "Ukraine", RU: "Russia", BY: "Belarus",
  LT: "Lithuania", LV: "Latvia", EE: "Estonia", MD: "Moldova", RS: "Serbia",
  HR: "Croatia", BA: "Bosnia and Herzegovina", SI: "Slovenia", MK: "North Macedonia",
  AL: "Albania", ME: "Montenegro", CY: "Cyprus", MT: "Malta", LU: "Luxembourg",
  IL: "Israel", SA: "Saudi Arabia", AE: "United Arab Emirates", QA: "Qatar",
  KW: "Kuwait", BH: "Bahrain", OM: "Oman", JO: "Jordan", LB: "Lebanon",
  IQ: "Iraq", IR: "Iran", PK: "Pakistan", IN: "India", BD: "Bangladesh",
  LK: "Sri Lanka", NP: "Nepal", BT: "Bhutan", MV: "Maldives", AF: "Afghanistan",
  CN: "China", JP: "Japan", KR: "South Korea", TW: "Taiwan", HK: "Hong Kong",
  MO: "Macao", SG: "Singapore", MY: "Malaysia", ID: "Indonesia", TH: "Thailand",
  VN: "Vietnam", PH: "Philippines", KH: "Cambodia", LA: "Laos", MM: "Myanmar",
  MN: "Mongolia", KZ: "Kazakhstan", UZ: "Uzbekistan", KG: "Kyrgyzstan",
  TJ: "Tajikistan", TM: "Turkmenistan", GE: "Georgia", AM: "Armenia", AZ: "Azerbaijan",
  BR: "Brazil", AR: "Argentina", MX: "Mexico", CL: "Chile", CO: "Colombia",
  PE: "Peru", VE: "Venezuela", EC: "Ecuador", UY: "Uruguay", PY: "Paraguay",
  BO: "Bolivia", CR: "Costa Rica", PA: "Panama", GT: "Guatemala", DO: "Dominican Republic",
  CU: "Cuba", JM: "Jamaica", TT: "Trinidad and Tobago", HT: "Haiti",
  AU: "Australia", NZ: "New Zealand", FJ: "Fiji", PG: "Papua New Guinea",
  SB: "Solomon Islands", VU: "Vanuatu", WS: "Samoa", TO: "Tonga",
  SS: "South Sudan", SD: "Sudan", CD: "DR Congo", CG: "Republic of the Congo",
  CM: "Cameroon", CI: "Côte d'Ivoire", SN: "Senegal", ML: "Mali", BF: "Burkina Faso",
  NE: "Niger", TD: "Chad", MG: "Madagascar", MZ: "Mozambique", ZM: "Zambia",
  ZW: "Zimbabwe", BW: "Botswana", NA: "Namibia", LS: "Lesotho", SZ: "Eswatini",
  AO: "Angola", GN: "Guinea", SL: "Sierra Leone", LR: "Liberia", GM: "Gambia",
};

const TIMEZONES: Record<string, string[]> = {
  UG: ["Africa/Kampala"], KE: ["Africa/Nairobi"], TZ: ["Africa/Dar_es_Salaam"], RW: ["Africa/Kigali"],
  NG: ["Africa/Lagos"], GH: ["Africa/Accra"], ZA: ["Africa/Johannesburg"], EG: ["Africa/Cairo"],
  ET: ["Africa/Addis_Ababa"], MA: ["Africa/Casablanca"], SD: ["Africa/Khartoum"], SS: ["Africa/Juba"],
  CD: ["Africa/Kinshasa", "Africa/Lubumbashi"], CM: ["Africa/Douala"], CI: ["Africa/Abidjan"],
  SN: ["Africa/Dakar"], ML: ["Africa/Bamako"], BF: ["Africa/Ouagadougou"], NE: ["Africa/Niamey"],
  TD: ["Africa/Ndjamena"], MG: ["Africa/Antananarivo"], MZ: ["Africa/Maputo"], ZM: ["Africa/Lusaka"],
  ZW: ["Africa/Harare"], BW: ["Africa/Gaborone"], NA: ["Africa/Windhoek"], LS: ["Africa/Maseru"],
  SZ: ["Africa/Mbabane"], AO: ["Africa/Luanda"], GN: ["Africa/Conakry"], SL: ["Africa/Freetown"],
  LR: ["Africa/Monrovia"], GM: ["Africa/Banjal"], CG: ["Africa/Brazzaville"],
  US: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  CA: ["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax"],
  MX: ["America/Mexico_City", "America/Tijuana", "America/Monterrey"],
  BR: ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza"],
  AR: ["America/Argentina/Buenos_Aires"], CL: ["America/Santiago"], CO: ["America/Bogota"],
  PE: ["America/Lima"], VE: ["America/Caracas"], EC: ["America/Guayaquil"], UY: ["America/Montevideo"],
  PY: ["America/Asuncion"], BO: ["America/La_Paz"], CR: ["America/Costa_Rica"], PA: ["America/Panama"],
  GT: ["America/Guatemala"], DO: ["America/Santo_Domingo"], CU: ["America/Havana"], JM: ["America/Jamaica"],
  TT: ["America/Port_of_Spain"], HT: ["America/Port-au-Prince"],
  GB: ["Europe/London"], IE: ["Europe/Dublin"], PT: ["Europe/Lisbon"], ES: ["Europe/Madrid"],
  FR: ["Europe/Paris"], BE: ["Europe/Brussels"], NL: ["Europe/Amsterdam"], LU: ["Europe/Luxembourg"],
  DE: ["Europe/Berlin"], AT: ["Europe/Vienna"], CH: ["Europe/Zurich"], IT: ["Europe/Rome"],
  MT: ["Europe/Malta"], GR: ["Europe/Athens"], CY: ["Asia/Nicosia"], TR: ["Europe/Istanbul"],
  DK: ["Europe/Copenhagen"], NO: ["Europe/Oslo"], SE: ["Europe/Stockholm"], FI: ["Europe/Helsinki"],
  IS: ["Atlantic/Reykjavik"], PL: ["Europe/Warsaw"], CZ: ["Europe/Prague"], SK: ["Europe/Bratislava"],
  HU: ["Europe/Budapest"], RO: ["Europe/Bucharest"], BG: ["Europe/Sofia"], MD: ["Europe/Chisinau"],
  UA: ["Europe/Kyiv"], BY: ["Europe/Minsk"], RU: ["Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"],
  LT: ["Europe/Vilnius"], LV: ["Europe/Riga"], EE: ["Europe/Tallinn"], RS: ["Europe/Belgrade"],
  HR: ["Europe/Zagreb"], BA: ["Europe/Sarajevo"], SI: ["Europe/Ljubljana"], MK: ["Europe/Skopje"],
  AL: ["Europe/Tirane"], ME: ["Europe/Podgorica"], IL: ["Asia/Jerusalem"],
  SA: ["Asia/Riyadh"], AE: ["Asia/Dubai"], QA: ["Asia/Qatar"], KW: ["Asia/Kuwait"], BH: ["Asia/Bahrain"],
  OM: ["Asia/Muscat"], JO: ["Asia/Amman"], LB: ["Asia/Beirut"], IQ: ["Asia/Baghdad"],
  IR: ["Asia/Tehran"], PK: ["Asia/Karachi"], IN: ["Asia/Kolkata"], BD: ["Asia/Dhaka"],
  LK: ["Asia/Colombo"], NP: ["Asia/Kathmandu"], BT: ["Asia/Thimphu"], MV: ["Indian/Maldives"],
  AF: ["Asia/Kabul"], CN: ["Asia/Shanghai", "Asia/Urumqi"], JP: ["Asia/Tokyo"], KR: ["Asia/Seoul"],
  TW: ["Asia/Taipei"], HK: ["Asia/Hong_Kong"], MO: ["Asia/Macau"], SG: ["Asia/Singapore"],
  MY: ["Asia/Kuala_Lumpur"], ID: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
  TH: ["Asia/Bangkok"], VN: ["Asia/Ho_Chi_Minh"], PH: ["Asia/Manila"], KH: ["Asia/Phnom_Penh"],
  LA: ["Asia/Vientiane"], MM: ["Asia/Yangon"], MN: ["Asia/Ulaanbaatar"],
  KZ: ["Asia/Almaty"], UZ: ["Asia/Tashkent"], KG: ["Asia/Bishkek"], TJ: ["Asia/Dushanbe"],
  TM: ["Asia/Ashgabat"], GE: ["Asia/Tbilisi"], AM: ["Asia/Yerevan"], AZ: ["Asia/Baku"],
  AU: ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide"],
  NZ: ["Pacific/Auckland"], FJ: ["Pacific/Fiji"], PG: ["Pacific/Port_Moresby"],
  SB: ["Pacific/Guadalcanal"], VU: ["Pacific/Efate"], WS: ["Pacific/Apia"], TO: ["Pacific/Tongatapu"],
};

const TYPE_LABELS: Record<string, string> = {
  MOBILE: "Mobile",
  FIXED_LINE: "Fixed line",
  FIXED_LINE_OR_MOBILE: "Fixed line or mobile",
  VOIP: "VoIP",
  PAGER: "Pager",
  UAN: "Universal access number",
  PERSONAL_NUMBER: "Personal number",
  PREMIUM_RATE: "Premium rate",
  SHARED_COST: "Shared cost",
  TOLL_FREE: "Toll free",
  VOICEMAIL: "Voicemail",
  UNKNOWN: "Unknown type",
};

export async function POST(req: Request) {
  let raw = "";
  try {
    const body = (await req.json()) as { phone?: unknown };
    raw = String(body?.phone ?? "").trim();
  } catch {
    /* fallthrough */
  }
  if (!raw || raw.length > 40) {
    return Response.json({ error: "Enter a phone number, e.g. +256 772 123 456." }, { status: 400 });
  }

  const notes: string[] = [];
  const pn = parsePhoneNumberFromString(raw);

  if (!pn) {
    return Response.json(
      {
        error:
          "Could not parse that as a phone number. Include the country code, e.g. +256772123456.",
      } satisfies Partial<PhoneReport> & { error: string },
      { status: 400 },
    );
  }

  const valid = pn.isValid();
  const possible = pn.isPossible();
  const iso = (pn.country as string | undefined) ?? null;

  if (!valid && possible) notes.push("Number is possible for its country but fails full validation — check the digits.");
  if (!valid && !possible) notes.push("Number is not valid for its country — likely a typo or wrong country code.");
  if (valid) notes.push("Number passes full E.164 validation for its country.");

  const rawType = typeof pn.getType === "function" ? pn.getType() : undefined;
  const type = rawType && TYPE_LABELS[rawType] ? TYPE_LABELS[rawType] : null;
  if (type) notes.push(`Number type: ${type}.`);
  notes.push("Carrier/line-owner lookup requires a paid number-intelligence API and is not included.");
  notes.push("Only publicly documented number formats are analyzed — no call or SMS is ever made.");

  const report: PhoneReport = {
    input: raw,
    valid,
    possible,
    e164: pn.number,
    international: pn.formatInternational(),
    national: pn.formatNational(),
    rfc3966: typeof pn.getURI === "function" ? pn.getURI() : null,
    country: iso,
    countryName: iso ? COUNTRY_NAMES[iso] ?? null : null,
    countryCode: `+${pn.countryCallingCode}`,
    type,
    timezones: iso ? TIMEZONES[iso] ?? [] : [],
    notes,
    generatedAt: new Date().toISOString(),
  };

  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
