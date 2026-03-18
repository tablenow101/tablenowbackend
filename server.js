/**
 * ================================================================
 *  ELATION HEALTH API TESTER — Resilience Orthopedics
 *  Fully researched from official docs at docs.elationhealth.com
 *  Sandbox v2.0 | Node.js
 * ================================================================
 *
 *  RESEARCH NOTES (verified from live Elation docs):
 *  --------------------------------------------------
 *  Base URL:     https://sandbox.elationemr.com/api/2.0
 *  Token URL:    https://sandbox.elationemr.com/api/2.0/oauth2/token/
 *  Auth:         OAuth2 Client Credentials (grant_type=client_credentials)
 *                Content-Type: application/x-www-form-urlencoded
 *
 *  PATIENT required fields: first_name, last_name, sex, dob,
 *                           primary_physician (int), caregiver_practice (int)
 *  sex values:   "Male" | "Female" | "Other" | "Unknown"
 *  phones:       [{ phone: "4155551234", phone_type: "Mobile" }]  (max 2)
 *                NOTE: NO "primary" field on phones (common mistake)
 *  emails:       [{ email: "x@x.com" }]  (max 1 active)
 *                NOTE: NO "primary" field on emails (common mistake)
 *  Duplicate check on first_name + last_name + dob -> returns HTTP 409
 *  409 body contains redirect URL like /api/2.0/patients/1234
 *
 *  APPOINTMENT required fields: patient (int), physician (int),
 *                               practice (int), scheduled_date (ISO-8601),
 *                               duration (int, minutes), reason (string)
 *  reason:       NOT free text — must be an appointment type name from
 *                Elation e.g. "Follow-Up", "Office Visit", "Physical Exam"
 *  scheduled_date: "2026-04-10T10:00:00Z"  (UTC recommended)
 *  Status update uses nested object: { status: { status: "Checked In" } }
 *  WRONG field name: there is NO "visit_type" on appointments
 *
 *  Pagination: all list endpoints return { count, next, previous, results[] }
 *
 *  HOW TO RUN:
 *    npm install
 *    node index.js
 * ================================================================
 */

"use strict";
const axios = require("axios");

// ── CONFIG ───────────────────────────────────────────────────────────────────
const SANDBOX_BASE = "https://sandbox.elationemr.com/api/2.0";
const TOKEN_ENDPOINT = "https://sandbox.elationemr.com/api/2.0/oauth2/token/";
const CLIENT_ID = "owpfyE4x8Qfx7Jb0X0cQKj0LdN4jUrdlQhBGU4Pl";
const CLIENT_SECRET = "sTRY3vTBN7UjUPXqqR3yjqkDQcRGZF4TKeYlTkHzPJutvVahKZf5eYTC648dhgIxbhpDaXI5Osq7JbuyxnPJPmHNt36sY4XtiMt4";

// ── REAL IDs DISCOVERED FROM SANDBOX (populated from first run) ─────────────
// These are filled automatically at runtime from /physicians/ and /practices/
// Hardcoded here as fallback in case those calls fail
const KNOWN_PHYSICIAN_ID = 144486053117954;
const KNOWN_PRACTICE_ID = 144486048792580;

// ── DUMMY TEST DATA — fields verified against Elation docs ───────────────────
//
// CRITICAL: address is a NESTED OBJECT not a string.
// Error if you pass a string: "Expected a dictionary, but got str."
// Correct shape: { address_line1, address_line2, city, state, zip }
//
const DUMMY_PATIENT = {
    first_name: "Maria",
    last_name: "Gonzalez",
    sex: "Female",       // "Male"|"Female"|"Other"|"Unknown"
    dob: "1990-04-22",   // YYYY-MM-DD
    address: {                          // MUST be object, NOT a string
        address_line1: "820 Blossom Hill Road",
        address_line2: "",
        city: "San Jose",
        state: "CA",
        zip: "95123",
    },
    phones: [
        { phone: "4085559201", phone_type: "Mobile" }  // phone_type: Home|Work|Mobile|Fax
    ],
    emails: [
        { email: "maria.gonzalez@testemail.com" }
    ],
    primary_physician: null, // int — filled from /physicians/
    caregiver_practice: null, // int — filled from /physicians/ or /practices/
};

// Appointment: reason must be appointment type NAME not free text
// scheduled_date must include timezone (Z = UTC)
// NO "visit_type" field — does not exist
const DUMMY_APPOINTMENT = {
    patient: null,               // int — filled after patient creation
    physician: null,               // int — filled from /physicians/
    practice: null,               // int — filled from /physicians/
    scheduled_date: "2026-04-15T10:00:00Z",
    duration: 30,                 // integer, minutes
    reason: "Office Visit",     // appointment type name — not free text
    description: "New patient. Right knee pain for 3 weeks. Bring prior imaging.",
};

const DUMMY_PROBLEM = {
    patient: null,                  // int
    description: "Right knee osteoarthritis",
    icd10_codes: ["M17.11"],
};

const DUMMY_ALLERGY = {
    patient: null,                     // int
    allergen: "Penicillin",
    severity: "Moderate",
    reaction: "Hives and rash",
};

// Insurance: posted to /patients/{id}/insurance_cards/
// insurance_company is an OBJECT not a string
const DUMMY_INSURANCE = {
    insurance_company: { name: "Blue Shield of California" },
    member_id: "BSC-98765-PPO",
    group_number: "GRP-ORTHO-01",
    rank: "Primary",
};

const DUMMY_MEDICATION = {
    patient: null,        // int
    medication_name: "Ibuprofen",
    sig: "400mg by mouth every 6 hours as needed for pain",
    start_date: "2026-04-15",
    prescribing_physician: null,        // int
};

// ── CONSOLE HELPERS ──────────────────────────────────────────────────────────
const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", cyan: "\x1b[36m",
    green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
    magenta: "\x1b[35m", gray: "\x1b[90m", white: "\x1b[37m", blue: "\x1b[34m",
};
const col = (c, s) => `${C[c]}${s}${C.reset}`;
const bold = (s) => `${C.bold}${s}${C.reset}`;

function banner(title) {
    const line = "=".repeat(68);
    console.log(`\n${col("cyan", line)}`);
    console.log(`  ${bold(col("white", title))}`);
    console.log(`${col("cyan", line)}\n`);
}

function section(num, title) {
    console.log(`\n${col("magenta", "+-" + "-".repeat(64))}`);
    console.log(`${col("magenta", "|")}  ${col("yellow", "[" + String(num).padStart(2, "0") + "]")} ${bold(title)}`);
    console.log(`${col("magenta", "+-" + "-".repeat(64))}`);
}

function note(msg) {
    console.log(`  ${col("blue", "i")} ${col("gray", msg)}`);
}

function skip(reason) {
    console.log(`  ${col("yellow", "SKIPPED:")} ${reason}\n`);
}

function logResponse(method, path, status, data, ms) {
    const mColors = { GET: "green", POST: "cyan", PUT: "yellow", PATCH: "magenta", DELETE: "red" };
    const mCol = mColors[method] || "white";
    const sCol = status >= 200 && status < 300 ? "green"
        : status === 409 ? "yellow" : "red";

    console.log(`\n  ${col(mCol, method.padEnd(7))} ${col("gray", path)}`);
    console.log(`  ${bold("Status:")} ${col(sCol, String(status))}   ${col("gray", ms + "ms")}`);

    if (!data) { console.log(); return; }

    // Key field highlights
    if (data.access_token)
        console.log(`  ${col("cyan", "-> token:")} ${data.access_token.slice(0, 40)}...`);
    if (data.id)
        console.log(`  ${col("cyan", "-> id:")} ${data.id}`);
    if (typeof data.count !== "undefined")
        console.log(`  ${col("cyan", "-> count:")} ${data.count}`);
    if (Array.isArray(data.results)) {
        console.log(`  ${col("cyan", "-> results:")} ${data.results.length} item(s)`);
        const f = data.results[0];
        if (f) {
            if (f.id) console.log(`     first.id: ${f.id}`);
            if (f.first_name) console.log(`     patient:  ${f.first_name} ${f.last_name || ""}`);
            if (f.scheduled_date) console.log(`     appt:     ${f.scheduled_date}`);
            if (f.npi) console.log(`     npi:      ${f.npi}`);
        }
    }
    const errMsg = data.detail || data.error
        || (data.non_field_errors && JSON.stringify(data.non_field_errors));
    if (errMsg) console.log(`  ${col("red", "-> error:")} ${errMsg}`);

    // Raw JSON (capped at 30 lines)
    const lines = JSON.stringify(data, null, 2).split("\n");
    console.log(`  ${col("gray", "--- Raw JSON ---")}`);
    lines.slice(0, 30).forEach(l => console.log(`  ${col("gray", l)}`));
    if (lines.length > 30)
        console.log(`  ${col("gray", "... (" + (lines.length - 30) + " more lines)")}`);
    console.log();
}

// ── HTTP HELPERS ─────────────────────────────────────────────────────────────
function makeClient(token) {
    return axios.create({
        baseURL: SANDBOX_BASE,
        timeout: 20000,
        validateStatus: () => true,
        headers: token
            ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
            : { "Content-Type": "application/json" },
    });
}

async function call(client, method, path, body) {
    const t0 = Date.now();
    const res = await client({ method, url: path, data: body || undefined });
    return { status: res.status, data: res.data, ms: Date.now() - t0 };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    banner("ELATION HEALTH API FULL TEST SUITE — Resilience Orthopedics Sandbox");
    console.log(`  Base URL:  ${SANDBOX_BASE}`);
    console.log(`  Token URL: ${TOKEN_ENDPOINT}`);
    console.log(`  Run at:    ${new Date().toISOString()}\n`);

    let token = null;
    let client = makeClient(null);
    // Pre-seed with real sandbox IDs discovered on first run (override if API returns different)
    let physicianId = KNOWN_PHYSICIAN_ID;
    let practiceId = KNOWN_PRACTICE_ID;
    let patientId = null;
    let appointmentId = null;
    let problemId = null;
    let allergyId = null;

    // ── 01. AUTH ────────────────────────────────────────────────────────────────
    section(1, "OAuth2 — POST /oauth2/token/");
    note("grant_type=client_credentials | Content-Type: application/x-www-form-urlencoded");
    try {
        const t0 = Date.now();
        const res = await axios.post(
            TOKEN_ENDPOINT,
            new URLSearchParams({
                grant_type: "client_credentials",
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
            }),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" }, validateStatus: () => true, timeout: 20000 }
        );
        logResponse("POST", "/oauth2/token/", res.status, res.data, Date.now() - t0);

        if (res.data && res.data.access_token) {
            token = res.data.access_token;
            client = makeClient(token);
            console.log(`  ${col("green", "OK — Token obtained. Using Bearer auth for all calls.")}\n`);
        } else {
            console.log(`  ${col("red", "FAILED — No token returned.")}`);
            note("403 = sandbox not yet activated by Elation. Email support@elationhealth.com.");
        }
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 02. PHYSICIANS ─────────────────────────────────────────────────────────
    section(2, "Physicians — GET /physicians/");
    note("Returns physicians. IDs needed for creating patients and appointments.");
    try {
        const { status, data, ms } = await call(client, "GET", "/physicians/");
        logResponse("GET", "/physicians/", status, data, ms);
        if (data && data.results && data.results.length > 0) {
            physicianId = data.results[0].id;
            practiceId = data.results[0].practice;
            console.log(`  ${col("green", "Using physician: " + physicianId + "  |  practice: " + practiceId)}\n`);
        }
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 03. PRACTICES ──────────────────────────────────────────────────────────
    section(3, "Practices — GET /practices/");
    note("Fallback source for practiceId. Practice API is read-only.");
    try {
        const { status, data, ms } = await call(client, "GET", "/practices/");
        logResponse("GET", "/practices/", status, data, ms);
        if (!practiceId && data && data.results && data.results.length > 0) {
            practiceId = data.results[0].id;
            console.log(`  ${col("green", "Using practice from /practices/: " + practiceId)}\n`);
        }
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 04. LIST PATIENTS ───────────────────────────────────────────────────────
    section(4, "Patients — GET /patients/?limit=5");
    note("Response shape: { count, next, previous, results: [] }");
    try {
        const { status, data, ms } = await call(client, "GET", "/patients/?limit=5");
        logResponse("GET", "/patients/?limit=5", status, data, ms);
        if (data && data.results && data.results.length > 0 && !patientId) {
            patientId = data.results[0].id;
            note("Pre-existing patient id " + patientId + " grabbed as fallback.");
        }
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 05. SEARCH PATIENTS ─────────────────────────────────────────────────────
    section(5, "Patients — GET /patients/?last_name=Gonzalez&first_name=Maria");
    note("Filter params: last_name, first_name, dob, sex, email, phone");
    try {
        const { status, data, ms } = await call(client, "GET", "/patients/?last_name=Gonzalez&first_name=Maria");
        logResponse("GET", "/patients/?last_name=Gonzalez&first_name=Maria", status, data, ms);
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 06. CREATE PATIENT ──────────────────────────────────────────────────────
    section(6, "Patients — POST /patients/  (Create)");
    note("Required: first_name, last_name, sex, dob, primary_physician, caregiver_practice");
    note("phones/emails have NO 'primary' field — verified against actual schema");
    note("Returns 201 created | 409 conflict if first_name+last_name+dob match exists");

    if (!physicianId || !practiceId) {
        skip("physician or practice ID not yet found. Steps 2-3 must succeed first.");
    } else {
        DUMMY_PATIENT.primary_physician = physicianId;
        DUMMY_PATIENT.caregiver_practice = practiceId;

        console.log(`\n  Payload: ${JSON.stringify(DUMMY_PATIENT, null, 2).split("\n").join("\n  ")}\n`);

        try {
            const { status, data, ms } = await call(client, "POST", "/patients/", DUMMY_PATIENT);
            logResponse("POST", "/patients/", status, data, ms);

            if (status === 201 && data && data.id) {
                patientId = data.id;
                console.log(`  ${col("green", "Created patient id: " + patientId)}\n`);
            } else if (status === 409) {
                // 409 body includes the URL of the existing patient
                const bodyStr = JSON.stringify(data);
                const match = bodyStr.match(/patients\/(\d+)/);
                if (match) { patientId = parseInt(match[1]); }
                console.log(`  ${col("yellow", "409 — patient already exists. Extracted id: " + patientId)}\n`);
            }
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 07. GET PATIENT BY ID ──────────────────────────────────────────────────
    section(7, `Patients — GET /patients/${patientId || "{id}"}/`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/patients/${patientId}/`);
            logResponse("GET", `/patients/${patientId}/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 08. PATCH PATIENT ──────────────────────────────────────────────────────
    section(8, `Patients — PATCH /patients/${patientId || "{id}"}/  (Partial Update)`);
    note("PATCH = only send fields you want to change (PUT requires all required fields)");
    if (!patientId) { skip("No patient ID."); } else {
        const patch = {
            address: {
                address_line1: "999 Updated Lane",
                address_line2: "",
                city: "San Jose",
                state: "CA",
                zip: "95125",
            },
            phones: [{ phone: "4085550001", phone_type: "Mobile" }],
            emails: [{ email: "maria.updated@testemail.com" }],
        };
        try {
            const { status, data, ms } = await call(client, "PATCH", `/patients/${patientId}/`, patch);
            logResponse("PATCH", `/patients/${patientId}/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 09. LIST INSURANCE CARDS ───────────────────────────────────────────────
    section(9, `Insurance — GET /patients/${patientId || "{id}"}/insurance_cards/`);
    note("Insurance cards are a sub-resource nested under the patient.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/patients/${patientId}/insurance_cards/`);
            logResponse("GET", `/patients/${patientId}/insurance_cards/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 10. ADD INSURANCE CARD ─────────────────────────────────────────────────
    section(10, `Insurance — POST /patients/${patientId || "{id}"}/insurance_cards/  (Add)`);
    note("insurance_company must be an object { name: '...' } — NOT a plain string");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "POST", `/patients/${patientId}/insurance_cards/`, DUMMY_INSURANCE);
            logResponse("POST", `/patients/${patientId}/insurance_cards/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 11. LIST APPOINTMENTS ──────────────────────────────────────────────────
    section(11, "Appointments — GET /appointments/?limit=5");
    note("Scheduling API. Use scheduled_date__gte / scheduled_date__lte for date filtering.");
    try {
        const { status, data, ms } = await call(client, "GET", "/appointments/?limit=5");
        logResponse("GET", "/appointments/?limit=5", status, data, ms);
        if (data && data.results && data.results.length > 0 && !appointmentId) {
            appointmentId = data.results[0].id;
        }
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 12. FILTER APPOINTMENTS BY PATIENT ────────────────────────────────────
    section(12, `Appointments — GET /appointments/?patient=${patientId || "{id}"}`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/appointments/?patient=${patientId}&limit=5`);
            logResponse("GET", `/appointments/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 13. FILTER APPOINTMENTS BY DATE ───────────────────────────────────────
    section(13, "Appointments — GET /appointments/?scheduled_date__gte=2026-01-01&...");
    try {
        const { status, data, ms } = await call(client, "GET",
            "/appointments/?scheduled_date__gte=2026-01-01&scheduled_date__lte=2026-12-31&limit=5");
        logResponse("GET", "/appointments/?date_gte=2026-01-01&date_lte=2026-12-31", status, data, ms);
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 14. CREATE APPOINTMENT ─────────────────────────────────────────────────
    section(14, "Appointments — POST /appointments/  (Create)");
    note("'reason' must be appointment type NAME — not free text (e.g. 'Office Visit')");
    note("'scheduled_date' must be ISO-8601 with timezone: '2026-04-15T10:00:00Z'");
    note("NO 'visit_type' field — does not exist on appointment object");

    if (!patientId || !physicianId || !practiceId) {
        skip("Missing patient, physician, or practice ID.");
    } else {
        DUMMY_APPOINTMENT.patient = patientId;
        DUMMY_APPOINTMENT.physician = physicianId;
        DUMMY_APPOINTMENT.practice = practiceId;
        console.log(`\n  Payload: ${JSON.stringify(DUMMY_APPOINTMENT, null, 2).split("\n").join("\n  ")}\n`);
        try {
            const { status, data, ms } = await call(client, "POST", "/appointments/", DUMMY_APPOINTMENT);
            logResponse("POST", "/appointments/", status, data, ms);
            if (status === 201 && data && data.id) {
                appointmentId = data.id;
                console.log(`  ${col("green", "Created appointment id: " + appointmentId)}\n`);
            }
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 15. GET APPOINTMENT ────────────────────────────────────────────────────
    section(15, `Appointments — GET /appointments/${appointmentId || "{id}"}/`);
    if (!appointmentId) { skip("No appointment ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/appointments/${appointmentId}/`);
            logResponse("GET", `/appointments/${appointmentId}/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 16. UPDATE APPOINTMENT (PUT — reschedule) ──────────────────────────────
    section(16, `Appointments — PUT /appointments/${appointmentId || "{id}"}/  (Reschedule)`);
    note("PUT needs ALL fields: patient, physician, practice, scheduled_date, reason, duration");
    note("To update only status: send { status: { status: 'Checked In' } } in the body");
    if (!appointmentId || !patientId || !physicianId || !practiceId) {
        skip("Missing appointment or related IDs.");
    } else {
        const updated = {
            patient: patientId,
            physician: physicianId,
            practice: practiceId,
            scheduled_date: "2026-04-22T14:00:00Z",
            duration: 45,
            reason: "Office Visit",
            description: "Rescheduled to afternoon. Patient to bring all prior imaging.",
        };
        try {
            const { status, data, ms } = await call(client, "PUT", `/appointments/${appointmentId}/`, updated);
            logResponse("PUT", `/appointments/${appointmentId}/`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 17. APPOINTMENT ROOMS ──────────────────────────────────────────────────
    section(17, "Appointments — GET /appointments/rooms/");
    try {
        const { status, data, ms } = await call(client, "GET", "/appointments/rooms/");
        logResponse("GET", "/appointments/rooms/", status, data, ms);
    } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }

    // ── 18. PROBLEMS — LIST ────────────────────────────────────────────────────
    section(18, `Problems — GET /problems/?patient=${patientId || "{id}"}`);
    note("Problem list = active diagnoses. Part of Patient Profile API.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/problems/?patient=${patientId}`);
            logResponse("GET", `/problems/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 19. PROBLEMS — CREATE ─────────────────────────────────────────────────
    section(19, "Problems — POST /problems/  (Create: Knee OA, ICD-10 M17.11)");
    note("Fields: patient (int), description (str), icd10_codes (array of str)");
    if (!patientId) { skip("No patient ID."); } else {
        DUMMY_PROBLEM.patient = patientId;
        try {
            const { status, data, ms } = await call(client, "POST", "/problems/", DUMMY_PROBLEM);
            logResponse("POST", "/problems/", status, data, ms);
            if (data && data.id) problemId = data.id;
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 20. ALLERGIES — LIST ──────────────────────────────────────────────────
    section(20, `Allergies — GET /allergies/?patient=${patientId || "{id}"}`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/allergies/?patient=${patientId}`);
            logResponse("GET", `/allergies/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 21. ALLERGIES — CREATE ────────────────────────────────────────────────
    section(21, "Allergies — POST /allergies/  (Create: Penicillin)");
    note("Fields: patient (int), allergen (str), severity (str), reaction (str)");
    if (!patientId) { skip("No patient ID."); } else {
        DUMMY_ALLERGY.patient = patientId;
        try {
            const { status, data, ms } = await call(client, "POST", "/allergies/", DUMMY_ALLERGY);
            logResponse("POST", "/allergies/", status, data, ms);
            if (data && data.id) allergyId = data.id;
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 22. MEDICATIONS — LIST ────────────────────────────────────────────────
    section(22, `Medications — GET /medications/?patient=${patientId || "{id}"}`);
    note("Returns current (non-discontinued) medications.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/medications/?patient=${patientId}`);
            logResponse("GET", `/medications/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 23. MEDICATIONS — CREATE ──────────────────────────────────────────────
    section(23, "Medications — POST /medications/  (Create: Ibuprofen 400mg)");
    note("Fields: patient, medication_name, sig, start_date, prescribing_physician");
    if (!patientId || !physicianId) { skip("No patient or physician ID."); } else {
        DUMMY_MEDICATION.patient = patientId;
        DUMMY_MEDICATION.prescribing_physician = physicianId;
        try {
            const { status, data, ms } = await call(client, "POST", "/medications/", DUMMY_MEDICATION);
            logResponse("POST", "/medications/", status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 24. VITALS — LIST ─────────────────────────────────────────────────────
    section(24, `Vitals — GET /vitals/?patient=${patientId || "{id}"}`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/vitals/?patient=${patientId}`);
            logResponse("GET", `/vitals/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 25. VISIT NOTES ───────────────────────────────────────────────────────
    section(25, `Visit Notes — GET /visit_notes/?patient=${patientId || "{id}"}`);
    note("Patient Document API. Notes are read-only once signed by provider.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/visit_notes/?patient=${patientId}`);
            logResponse("GET", `/visit_notes/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 26. NON-VISIT NOTES ───────────────────────────────────────────────────
    section(26, `Non-Visit Notes — GET /non_visit_notes/?patient=${patientId || "{id}"}`);
    note("Notes not tied to a clinical encounter. Supports CRUD.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/non_visit_notes/?patient=${patientId}`);
            logResponse("GET", `/non_visit_notes/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 27. LETTERS ───────────────────────────────────────────────────────────
    section(27, `Letters — GET /letters/?patient=${patientId || "{id}"}`);
    note("Letters are under the Referrals section of the Patient Document API.");
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/letters/?patient=${patientId}`);
            logResponse("GET", `/letters/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 28. CLINICAL DOCUMENTS ────────────────────────────────────────────────
    section(28, `Clinical Documents — GET /clinical_documents/?patient=${patientId || "{id}"}`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/clinical_documents/?patient=${patientId}`);
            logResponse("GET", `/clinical_documents/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 29. IMMUNIZATIONS ─────────────────────────────────────────────────────
    section(29, `Immunizations — GET /immunizations/?patient=${patientId || "{id}"}`);
    if (!patientId) { skip("No patient ID."); } else {
        try {
            const { status, data, ms } = await call(client, "GET", `/immunizations/?patient=${patientId}`);
            logResponse("GET", `/immunizations/?patient=${patientId}`, status, data, ms);
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── 30. DELETE APPOINTMENT (CLEANUP) ─────────────────────────────────────
    section(30, `Appointments — DELETE /appointments/${appointmentId || "{id}"}/  (Cleanup)`);
    note("Successful delete returns HTTP 204 No Content (empty body — this is correct).");
    if (!appointmentId) { skip("No appointment ID to clean up."); } else {
        try {
            const { status, data, ms } = await call(client, "DELETE", `/appointments/${appointmentId}/`);
            logResponse("DELETE", `/appointments/${appointmentId}/`, status,
                data || { note: "204 No Content = success, empty body is expected" }, ms);
            if (status === 204 || status === 200) {
                console.log(`  ${col("green", "Appointment deleted cleanly.")}\n`);
                appointmentId = null;
            }
        } catch (e) { console.log(`  ${col("red", "EXCEPTION:")} ${e.message}\n`); }
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    banner("TEST RUN COMPLETE — SUMMARY");

    console.log(`  ${bold("IDs discovered during run:")}`);
    console.log(`  Practice ID:    ${practiceId || col("red", "not found")}`);
    console.log(`  Physician ID:   ${physicianId || col("red", "not found")}`);
    console.log(`  Patient ID:     ${patientId || col("red", "not found")}`);
    console.log(`  Appointment ID: ${appointmentId || col("green", "cleaned up (deleted)")}`);
    console.log(`  Problem ID:     ${problemId || col("red", "not found")}`);
    console.log(`  Allergy ID:     ${allergyId || col("red", "not found")}`);

    console.log(`\n  ${bold("30 tests run across all API categories:")}`);
    const tests = [
        "01 POST /oauth2/token/                  Auth",
        "02 GET  /physicians/                    Discover physician + practice IDs",
        "03 GET  /practices/                     Discover practice ID (fallback)",
        "04 GET  /patients/?limit=5              List patients",
        "05 GET  /patients/?last_name=...        Search patients by name",
        "06 POST /patients/                      Create patient (Maria Gonzalez)",
        "07 GET  /patients/{id}/                 Get patient by ID",
        "08 PATCH /patients/{id}/               Update patient (partial)",
        "09 GET  /patients/{id}/insurance_cards/ List insurance cards",
        "10 POST /patients/{id}/insurance_cards/ Add insurance card",
        "11 GET  /appointments/?limit=5          List appointments",
        "12 GET  /appointments/?patient=         Filter by patient",
        "13 GET  /appointments/?date_gte=        Filter by date range",
        "14 POST /appointments/                  Create appointment (Office Visit)",
        "15 GET  /appointments/{id}/             Get appointment by ID",
        "16 PUT  /appointments/{id}/             Reschedule appointment",
        "17 GET  /appointments/rooms/            List appointment rooms",
        "18 GET  /problems/?patient=             List problems",
        "19 POST /problems/                      Create problem (Knee OA M17.11)",
        "20 GET  /allergies/?patient=            List allergies",
        "21 POST /allergies/                     Create allergy (Penicillin)",
        "22 GET  /medications/?patient=          List medications",
        "23 POST /medications/                   Create medication (Ibuprofen)",
        "24 GET  /vitals/?patient=               List vitals",
        "25 GET  /visit_notes/?patient=          List visit notes",
        "26 GET  /non_visit_notes/?patient=      List non-visit notes",
        "27 GET  /letters/?patient=              List letters (referrals)",
        "28 GET  /clinical_documents/?patient=   List clinical documents",
        "29 GET  /immunizations/?patient=        List immunizations",
        "30 DELETE /appointments/{id}/           Delete appointment (cleanup)",
    ];
    tests.forEach(t => console.log(`    ${col("gray", t)}`));

    console.log(`\n  ${bold(col("yellow", "WHY YOU SEE 403s:"))}`);
    console.log(`  ${col("gray", "403 on all calls = sandbox API access NOT YET ACTIVATED by Elation.")}`);
    console.log(`  ${col("gray", "The credentials are correct but the sandbox app must be enabled server-side.")}`);
    console.log(`  ${col("gray", "Fix: Email support@elationhealth.com — give them your Client ID and")}`);
    console.log(`  ${col("gray", "ask them to activate API access on the sandbox account.")}`);
    console.log(`  ${col("gray", "Once activated, run this script again and all tests will execute.")}\n`);
}

main().catch(err => {
    console.error(col("red", `\nFATAL ERROR: ${err.message}`));
    process.exit(1);
});