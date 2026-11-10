import { expect, it, vi } from "vitest";
import fixture from "./fixtures/venues.json";
import { lookupVenue, type VenueTable } from "../src/sources/venue";
import {
  parseIcore,
  parseCcfPages,
  fetchVenueTables,
} from "../cli/fetch-venues";
it("finds exact acronyms, names and fuzzy suggestions with rank provenance", () => {
  const table = fixture as VenueTable;
  expect(lookupVenue(table, "ssw").matches[0]).toMatchObject({
    dblp: "conf/synthetic-widgets",
    ranks: [
      { system: "CCF", rank: "A", year: 2026, source: expect.any(String) },
      { system: "ICORE", rank: "B", year: 2026, source: expect.any(String) },
    ],
  });
  expect(
    lookupVenue(table, "Synthetic Symposium on Widget").matches[0]?.acronym,
  ).toBe("SSW");
  expect(lookupVenue(table, "zzzzzz").matches).toEqual([]);
});
it("parses quoted CSV with preserved edition and validates downloaded data", () => {
  const result = parseIcore(
    '1,"Synthetic Symposium, Widgets",SSW,ICORE2026,B,Yes,46,,\r\n',
    "https://ranking.example/",
  );
  expect(result[0]).toMatchObject({
    name: "Synthetic Symposium, Widgets",
    acronym: "SSW",
    ranks: [{ year: 2026, rank: "B" }],
  });
  expect(() =>
    parseIcore("<html>Access denied</html>", "https://ranking.example/"),
  ).toThrow();
});
it("extracts PDF table columns with wrapped titles and rank headings", () => {
  const item = (str: string, x: number, y: number) => ({ str, x, y });
  const result = parseCcfPages(
    [
      [
        item("（2026年）", 100, 700),
        item("一、A 类", 10, 650),
        item("序号", 10, 620),
        item("会议简称", 70, 620),
        item("会议全称", 220, 620),
        item("出版社", 410, 620),
        item("网址", 560, 620),
        item("1", 10, 590),
        item("SSW", 70, 590),
        item("Synthetic Symposium", 180, 596),
        item("on Widgets", 200, 584),
        item("Example", 410, 590),
        item("https://dblp.org/db/conf/synthetic-widgets/", 500, 590),
      ],
    ],
    "https://ranking.example/",
  );
  expect(result[0]).toMatchObject({
    name: "Synthetic Symposium on Widgets",
    acronym: "SSW",
    dblp: "conf/synthetic-widgets",
    ranks: [{ system: "CCF", rank: "A", year: 2026 }],
  });
});
it("fetches only official publication/export locations and merges rank records", async () => {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("By_category"))
      return new Response(
        '<a href="https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=synthetic">第七版目录</a>',
      );
    if (url.includes("download")) return new Response(new Uint8Array([1]));
    return new Response(
      "1,Synthetic Symposium on Widgets,SSW,ICORE2026,B,Yes,46,,",
    );
  });
  const table = await fetchVenueTables(fetchImpl, async () => [
    {
      name: "Synthetic Symposium on Widgets",
      acronym: "SSW",
      dblp: "conf/synthetic-widgets",
      ranks: [
        {
          system: "CCF",
          rank: "A",
          year: 2026,
          source: "https://www.ccf.org.cn/",
        },
      ],
    },
  ]);
  expect(table.venues).toHaveLength(1);
  expect(table.venues[0]?.ranks).toHaveLength(2);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it("keeps centered publisher fragments out of a wrapped renamed venue title", () => {
  const item = (str: string, x: number, y: number, width: number) => ({
    str,
    x,
    y,
    width,
  });
  const result = parseCcfPages(
    [
      [
        item("（2026年）", 100, 700, 50),
        item("三、C 类", 10, 650, 40),
        item("序号", 10, 620, 20),
        item("期刊简称", 70, 620, 45),
        item("期刊全称", 260, 620, 45),
        item("出版社", 410, 620, 33),
        item("1", 10, 580, 6),
        item("NEW", 70, 586, 30),
        item("（原 OLD）", 60, 574, 65),
        item("New Journal of Synthetic Systems", 150, 596, 240),
        item("（原 Journal of Synthetic", 180, 582, 180),
        item("Widgets）", 240, 568, 60),
        item("Example Press", 390, 586, 70),
        item("（原", 392, 574, 25),
        item(" Publisher）", 417, 574, 45),
        item("https://publisher.example/new", 500, 580, 150),
      ],
    ],
    "https://ranking.example/",
    [
      [
        [50, 610, 140, 640],
        [380, 610, 480, 640],
      ],
    ],
  );
  expect(result[0]).toMatchObject({
    name: "New Journal of Synthetic Systems （原 Journal of Synthetic Widgets）",
    acronym: "NEW（原 OLD）",
  });
  expect(result[0]?.dblp).toBeUndefined();
});
it("keeps a long former acronym and its closing bracket inside the acronym cell", () => {
  const item = (str: string, x: number, y: number, width = 30) => ({
    str,
    x,
    y,
    width,
  });
  const result = parseCcfPages(
    [
      [
        item("（2026年）", 100, 700),
        item("一、A 类", 10, 650),
        item("序号", 10, 620),
        item("会议简称", 70, 620, 40),
        item("出版社", 400, 620),
        item("1", 10, 580),
        item("NEW ATC", 60, 586, 65),
        item("（原 OLD ATC", 50, 574, 80),
        item("）", 132, 574, 10),
        item("Synthetic Annual Conference", 200, 580, 150),
        item("https://dblp.org/db/conf/invented/", 500, 580, 150),
      ],
    ],
    "https://ranking.example/",
    [
      [
        [45, 610, 150, 640],
        [380, 610, 480, 640],
      ],
    ],
  );
  expect(result[0]).toMatchObject({
    name: "Synthetic Annual Conference",
    acronym: "NEW ATC（原 OLD ATC）",
    dblp: "conf/invented",
  });
});
