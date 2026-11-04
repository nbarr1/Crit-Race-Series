import { describe, expect, it } from "vitest";
import { parseFinishTime, parseResultsSheet, splitCsv } from "@/lib/results-csv";
import { matchResults, normalizeName, type EventEntrant } from "@/lib/results-match";

describe("splitCsv", () => {
  it("handles quotes, doubled quotes, embedded commas, and CRLF", () => {
    expect(splitCsv('a,"b, c","say ""hi"""\r\n1,2,3\n', ",")).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseFinishTime", () => {
  it("reads common time formats", () => {
    expect(parseFinishTime("1:02:03")).toBe("01:02:03");
    expect(parseFinishTime("41:02.5")).toBe("00:41:02.5");
    expect(parseFinishTime("62:03")).toBe("01:02:03");
    expect(parseFinishTime("3723")).toBe("01:02:03");
    expect(parseFinishTime("")).toBeNull();
    expect(parseFinishTime("+1 lap")).toBeNull();
    expect(parseFinishTime("1:75:00")).toBeNull();
  });
});

describe("parseResultsSheet", () => {
  it("reads a typical timing export", () => {
    const sheet = parseResultsSheet(
      "﻿Place,Bib,Name,Team,Laps,Time\n1,101,Rita Ortiz,Ridgeline,20,41:02.5\n2,102,\"Doe, Jan\",,20,41:03\nDNF,103,Sam Lee,,12,\n",
    );
    expect(sheet.errors).toEqual([]);
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.rows[0]).toMatchObject({ line: 2, place: 1, status: "finished", bib: 101, name: "Rita Ortiz", team: "Ridgeline", laps: 20, finishTime: "00:41:02.5" });
    expect(sheet.rows[1].name).toBe("Doe, Jan");
    expect(sheet.rows[2]).toMatchObject({ place: null, status: "DNF", bib: 103 });
  });

  it("accepts header aliases, first and last name columns, tabs, and a status column", () => {
    const sheet = parseResultsSheet("Pos\tBib #\tFirst Name\tLast Name\tStatus\n1st\t#7\tAna\tBell\t\n2\t8\tBo\tCho\tDSQ\n");
    expect(sheet.errors).toEqual([]);
    expect(sheet.rows[0]).toMatchObject({ place: 1, bib: 7, name: "Ana Bell", status: "finished" });
    expect(sheet.rows[1]).toMatchObject({ place: null, status: "DQ", name: "Bo Cho" });
  });

  it("works with semicolons and skips blank lines", () => {
    const sheet = parseResultsSheet("place;name\n\n1;A\n;;\n2;B\n");
    expect(sheet.errors).toEqual([]);
    expect(sheet.rows.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("needs a name or bib column and a place column", () => {
    expect(parseResultsSheet("place,laps\n1,20\n").errors[0].message).toMatch(/rider name/);
    expect(parseResultsSheet("name,laps\nA,20\n").errors[0].message).toMatch(/Place column/);
    expect(parseResultsSheet("   ").errors[0].message).toMatch(/empty/);
    expect(parseResultsSheet("place,name\n").errors[0].message).toMatch(/no result rows/);
  });

  it("reports bad rows with their line numbers", () => {
    const sheet = parseResultsSheet("place,bib,name,status\nfirst,1,A,\n2,x,B,\n3,,,\n,4,D,\n5,5,E,crashed\n");
    expect(sheet.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(sheet.rows).toHaveLength(0);
  });

  it("rejects duplicate places and bibs", () => {
    const sheet = parseResultsSheet("place,bib,name\n1,10,A\n1,11,B\n2,10,C\n");
    expect(sheet.errors.map((e) => e.message)).toEqual(["Place 1 is also on line 2.", "Bib 10 is also on line 2."]);
  });

  it("warns about gaps in the places, without blocking", () => {
    const sheet = parseResultsSheet("place,name\n1,A\n3,B\n");
    expect(sheet.errors).toEqual([]);
    expect(sheet.warnings[0].message).toBe("No rider is listed in place 2.");
  });

  it("gives non-finishers no place even if the sheet lists one", () => {
    const sheet = parseResultsSheet("place,name,status\n4,A,DNS\n");
    expect(sheet.rows[0]).toMatchObject({ place: null, status: "DNS" });
  });
});

const EC_A = "ec-a";
const EC_B = "ec-b";
const entrants: EventEntrant[] = [
  { riderId: "r1", eventCategoryId: EC_A, categoryName: "A", bib: 101, firstName: "Rita", lastName: "Ortiz", displayName: "", team: null },
  { riderId: "r2", eventCategoryId: EC_A, categoryName: "A", bib: 102, firstName: "José", lastName: "Núñez", displayName: "Pepe", team: null },
  { riderId: "r3", eventCategoryId: EC_B, categoryName: "B", bib: 201, firstName: "Sam", lastName: "Lee", displayName: "", team: null },
  { riderId: "r4", eventCategoryId: EC_A, categoryName: "A", bib: null, firstName: "Sam", lastName: "Lee", displayName: "", team: null },
  { riderId: "r5", eventCategoryId: EC_B, categoryName: "B", bib: null, firstName: "Alex", lastName: "Kim", displayName: "", team: null },
  { riderId: "r6", eventCategoryId: EC_B, categoryName: "B", bib: null, firstName: "Alex", lastName: "Kim", displayName: "", team: null },
];

function rows(csv: string) {
  const sheet = parseResultsSheet(csv);
  expect(sheet.errors).toEqual([]);
  return matchResults(sheet.rows, entrants, EC_A);
}

describe("normalizeName", () => {
  it("drops accents, case, and punctuation", () => {
    expect(normalizeName("  José  NÚÑEZ-Smith ")).toBe("jose nunez smith");
  });
});

describe("matchResults", () => {
  it("matches by bib first", () => {
    const [m] = rows("place,bib,name\n1,101,Rita Ortiz\n");
    expect(m).toMatchObject({ riderId: "r1", method: "bib", notes: [] });
  });

  it("notes when the bib's rider has a different name on the sheet", () => {
    const [m] = rows("place,bib,name\n1,101,Someone Else\n");
    expect(m.riderId).toBe("r1");
    expect(m.notes[0]).toMatch(/Bib 101 belongs to Rita Ortiz/);
  });

  it("notes a bib from another category", () => {
    const [m] = rows("place,bib\n1,201\n");
    expect(m).toMatchObject({ riderId: "r3", method: "bib" });
    expect(m.notes[0]).toMatch(/registered in B/);
  });

  it("falls back to the name when the bib is unknown", () => {
    const [m] = rows("place,bib,name\n1,999,rita ortiz\n");
    expect(m).toMatchObject({ riderId: "r1", method: "name" });
    expect(m.notes[0]).toMatch(/No rider at this event has bib 999/);
  });

  it("matches names regardless of accents, order, or display name", () => {
    const [a, b, c] = rows("place,name\n1,Jose Nunez\n2,\"Ortiz, Rita\"\n3,Pepe\n");
    expect(a.riderId).toBe("r2");
    expect(b.riderId).toBe("r1");
    // Rows 1 and 3 both matched r2, so the later one loses its match.
    expect(c).toMatchObject({ riderId: null, method: "none" });
  });

  it("prefers a rider registered in the category being scored", () => {
    const [m] = rows("place,name\n1,Sam Lee\n");
    expect(m.riderId).toBe("r4");
  });

  it("leaves ambiguous and unknown names unmatched", () => {
    const [a, b] = rows("place,name\n1,Alex Kim\n2,Nobody Here\n");
    expect(a).toMatchObject({ riderId: null, method: "none" });
    expect(a.notes[0]).toMatch(/More than one rider/);
    expect(b).toMatchObject({ riderId: null, method: "none" });
    expect(b.notes[0]).toMatch(/No registered rider/);
  });

  it("does not match the same rider twice", () => {
    const [a, b] = rows("place,bib,name\n1,101,Rita Ortiz\n2,,Rita Ortiz\n");
    expect(a.riderId).toBe("r1");
    expect(b.riderId).toBeNull();
    expect(b.notes.at(-1)).toMatch(/already matched on line 2/);
  });
});
