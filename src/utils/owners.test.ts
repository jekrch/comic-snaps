import { describe, expect, it } from "vitest";
import type { Owner, Publisher } from "../types";
import { buildPublisherIndex } from "./publishers";
import {
  CORPORATE_OWNERSHIP,
  buildOwnershipIndex,
  describeLink,
  ownerBadge,
  ownershipChain,
  ownershipType,
  stepMarks,
} from "./owners";

function pub(over: Partial<Publisher> & { id: string; name: string }): Publisher {
  return {
    kind: "publisher",
    parent: null,
    aliases: [],
    description: "",
    imageUrl: null,
    references: [],
    ids: {},
    ...over,
  };
}

const dc = pub({ id: "dc", name: "DC Comics" });
const vertigo = pub({ id: "vertigo", name: "Vertigo", kind: "imprint", parent: "dc" });
const absolute = pub({ id: "absolute", name: "Absolute Universe", kind: "imprint", parent: "dc" });
const boom = pub({ id: "boom", name: "Boom! Studios" });
const pantheon = pub({ id: "pantheon", name: "Pantheon Books" });
const pantheonImprint = pub({ id: "pantheon-graphic", name: "Pantheon Graphic", kind: "imprint", parent: "pantheon" });
const image = pub({ id: "image", name: "Image Comics" });
const skybound = pub({ id: "skybound", name: "Skybound", kind: "imprint", parent: "image" });

const owners: Owner[] = [
  { id: "conglomerate", name: "Conglomerate", kind: "media conglomerate", parent: null },
  {
    id: "products",
    name: "Products",
    kind: "division",
    parent: "conglomerate",
    since: 2026,
    publishers: [{ id: "dc", since: 2026, price: "$1" }],
  },
  { id: "group", name: "Group", kind: "media group", parent: null },
  {
    id: "books",
    name: "Books",
    kind: "book publisher",
    parent: "group",
    stake: "majority",
    since: 2020,
    publishers: [{ id: "boom", since: 2024 }],
  },
  { id: "knopf", name: "Knopf", kind: "publishing group", parent: "books", publishers: [{ id: "pantheon" }] },
];

const publishers = buildPublisherIndex([dc, vertigo, absolute, boom, pantheon, pantheonImprint, image, skybound]);
const ownership = buildOwnershipIndex(owners);

const keys = (p: Publisher) => ownershipChain(p, publishers, ownership)?.map((s) => s.key);

describe("ownershipChain", () => {
  it("runs from the top owner down to the house", () => {
    expect(keys(dc)).toEqual(["o:conglomerate", "o:products", "p:dc"]);
    expect(keys(pantheon)).toEqual(["o:group", "o:books", "o:knopf", "p:pantheon"]);
  });

  it("puts an imprint under its publisher, below the publisher's owners", () => {
    expect(keys(vertigo)).toEqual(["o:conglomerate", "o:products", "p:dc", "p:vertigo"]);
  });

  it("is null when no owner sits above the house or its publisher", () => {
    expect(ownershipChain(image, publishers, ownership)).toBeNull();
    expect(ownershipChain(skybound, publishers, ownership)).toBeNull();
  });

  it("carries how each rung holds the next, nothing at the top or on an imprint", () => {
    const chain = ownershipChain(vertigo, publishers, ownership)!;
    expect(chain[0].link).toBeNull();
    expect(chain[1].link?.since).toBe(2026);
    expect(chain[2].link?.price).toBe("$1");
    expect(chain[3].link).toBeNull();
  });

  it("lists the other houses each rung holds, off the line down", () => {
    const chain = ownershipChain(boom, publishers, ownership)!;
    expect(chain.map((s) => s.siblings.map((p) => p.id))).toEqual([[], ["pantheon"], []]);
    // An imprint's sister imprint shows beside it, under their publisher.
    const v = ownershipChain(vertigo, publishers, ownership)!;
    expect(v[2].siblings.map((p) => p.id)).toEqual(["absolute"]);
  });

  it("leaves out an imprint whose publisher is already listed", () => {
    const chain = ownershipChain(boom, publishers, ownership)!;
    expect(chain[1].siblings.map((p) => p.id)).not.toContain("pantheon-graphic");
  });

  it("stops at an imprint that has an owner of its own", () => {
    const studio = buildOwnershipIndex([
      ...owners,
      { id: "image-partners", name: "Partners", kind: "partners", parent: null, publishers: [{ id: "image" }] },
      { id: "kirkman", name: "Kirkman", kind: "founder", parent: null, status: "Independent", publishers: [{ id: "skybound" }] },
    ]);
    expect(ownershipChain(skybound, publishers, studio)?.map((s) => s.key)).toEqual(["o:kirkman", "p:skybound"]);
    // …and isn't listed among the house's own.
    expect(ownershipChain(image, publishers, studio)?.map((s) => s.siblings.length)).toEqual([0, 0]);
  });

  it("survives a loop in the owners", () => {
    const looped = buildOwnershipIndex([
      { id: "a", name: "A", kind: "x", parent: "b", publishers: [{ id: "image" }] },
      { id: "b", name: "B", kind: "x", parent: "a" },
    ]);
    expect(ownershipChain(image, publishers, looped)?.map((s) => s.key)).toEqual(["o:b", "o:a", "p:image"]);
  });
});

describe("describeLink", () => {
  it("reads stake, span and price", () => {
    expect(describeLink({ stake: "majority", since: 2025 })).toBe("majority stake since 2025");
    expect(describeLink({ since: 2009, price: "$4 billion" })).toBe("since 2009 · $4 billion");
    expect(describeLink({ since: 1992, until: 1998 })).toBe("1992–1998");
    expect(describeLink({ stake: "controlling" })).toBe("controlling stake");
    expect(describeLink({})).toBe("");
    expect(describeLink(null)).toBe("");
  });
});

describe("ownerBadge", () => {
  const family: Owner[] = [
    { id: "family", name: "Family", kind: "controlling shareholders", parent: null },
    {
      id: "conglomerate",
      name: "Conglomerate",
      kind: "media conglomerate",
      parent: "family",
      logo: { url: "https://example.com/c.png" },
    },
    { id: "products", name: "Products", kind: "division", parent: "conglomerate", publishers: [{ id: "dc" }] },
    { id: "groth", name: "Founder", kind: "co-founder", parent: null, status: "Independent", publishers: [{ id: "boom" }] },
    {
      id: "light",
      name: "Light Mark",
      kind: "media company",
      parent: null,
      logo: { url: "data/owner-logos/x.png", onDark: true },
      publishers: [{ id: "pantheon" }],
    },
  ];
  const dcLogos = pub({
    id: "dc",
    name: "DC Comics",
    imageUrl: "https://example.com/dc-now.png",
    logos: [{ url: "https://example.com/dc-1977.png", from: 1977, until: 2005 }],
  });
  const index = buildPublisherIndex([dcLogos, vertigo, boom, pantheon, image]);
  const held = buildOwnershipIndex(family);
  const badge = (p: Publisher, year?: number) => ownerBadge(p, year, index, held);

  it("names the family at the top of the chain, with no mark of its own", () => {
    expect(badge(dcLogos)).toMatchObject({ name: "Family", logo: null, status: null });
  });

  it("shows a person's portrait where a company would have its logo", () => {
    const person = buildOwnershipIndex(
      family.map((o) => (o.id === "family" ? { ...o, portrait: { url: "https://example.com/p.png" } } : o))
    );
    expect(ownerBadge(dcLogos, 2020, index, person).logo).toEqual({
      url: "https://example.com/p.png",
      onDark: false,
      portrait: true,
    });
  });

  it("names the top company when no family sits over it", () => {
    const corp = buildOwnershipIndex(family.filter((o) => o.id !== "family").map((o) => (o.id === "conglomerate" ? { ...o, parent: null } : o)));
    expect(ownerBadge(dcLogos, 2020, index, corp)).toMatchObject({
      name: "Conglomerate",
      logo: { url: "https://example.com/c.png", onDark: false },
    });
  });

  it("follows an imprint up to its publisher's owners, keeping the imprint as the house", () => {
    const b = badge(vertigo);
    expect(b.name).toBe("Family");
    expect(b.house.id).toBe("vertigo");
  });

  it("carries a light mark's need for a dark tile", () => {
    expect(badge(pantheon).logo).toEqual({ url: "data/owner-logos/x.png", onDark: true });
  });

  it("names the house itself when people own it, with their status and its own mark", () => {
    expect(badge(boom)).toMatchObject({ name: "Boom! Studios", status: "Independent", logo: null });
  });

  it("uses the house's logo for the year when the house is the top company", () => {
    const solo = buildOwnershipIndex([
      { id: "people", name: "People", kind: "founders", parent: null, status: "Independent", publishers: [{ id: "dc" }] },
    ]);
    expect(ownerBadge(dcLogos, 1990, index, solo).logo?.url).toBe("https://example.com/dc-1977.png");
    expect(ownerBadge(dcLogos, 2020, index, solo).logo?.url).toBe("https://example.com/dc-now.png");
  });

  it("falls back to the house when nothing owns it", () => {
    expect(badge(image)).toMatchObject({ name: "Image Comics", status: null, logo: null });
  });
});

describe("stepMarks", () => {
  const owner = (over: Partial<Owner>): Owner => ({ id: "o", name: "O", kind: "", parent: null, ...over });
  const portraits: Record<string, string> = { kirkman: "https://example.com/kirkman.jpg" };
  const portraitOf = (id: string) => portraits[id];
  const marks = (step: { owner?: Owner; publisher?: Publisher }, year?: number) =>
    stepMarks({ owner: step.owner ?? null, publisher: step.publisher ?? null }, portraitOf, year);

  it("shows a company's logo", () => {
    expect(marks({ owner: owner({ logo: { url: "l.png", onDark: true } }) })).toEqual([{ url: "l.png", onDark: true }]);
  });

  it("shows a person's portrait", () => {
    expect(marks({ owner: owner({ portrait: { url: "p.jpg" } }) })).toEqual([{ url: "p.jpg", onDark: false, portrait: true }]);
  });

  it("shows each of the people's faces, their own photo first, else their artist record's", () => {
    const people = owner({
      status: "Partner-owned",
      people: [
        { name: "McFarlane", portrait: { url: "mcf.jpg" } },
        { name: "Kirkman", artistId: "kirkman" },
        { name: "Nobody", artistId: "unknown" },
        { name: "Unlinked" },
      ],
    });
    expect(marks({ owner: people }).map((m) => m.url)).toEqual(["mcf.jpg", "https://example.com/kirkman.jpg"]);
  });

  it("shows a house's logo for the year", () => {
    const house = pub({
      id: "dc",
      name: "DC Comics",
      imageUrl: "now.png",
      logos: [{ url: "1977.png", from: 1977, until: 2005 }],
    });
    expect(marks({ publisher: house }, 1990)).toEqual([{ url: "1977.png", onDark: false }]);
    expect(marks({ publisher: house })).toEqual([{ url: "now.png", onDark: false }]);
  });

  it("is empty when there is nothing to show", () => {
    expect(marks({ owner: owner({}) })).toEqual([]);
    expect(marks({ publisher: pub({ id: "x", name: "X" }) })).toEqual([]);
  });
});

describe("ownershipType", () => {
  const people: Owner[] = [
    { id: "family", name: "Family", kind: "controlling shareholders", parent: null },
    { id: "products", name: "Products", kind: "division", parent: "family", publishers: [{ id: "dc" }] },
    { id: "partners", name: "Partners", kind: "its partners", parent: null, status: "Partner-owned", publishers: [{ id: "image" }] },
    { id: "backers", name: "Backers", kind: "investors", parent: null, status: "Investor-backed", publishers: [{ id: "skybound" }] },
  ];
  const held = buildOwnershipIndex(people);
  const type = (p: Publisher) => ownershipType(p, publishers, held);

  it("files a house under a company, a family over it included, as corporate", () => {
    expect(type(dc)).toBe(CORPORATE_OWNERSHIP);
    expect(type(vertigo)).toBe(CORPORATE_OWNERSHIP);
  });

  it("takes the people-owner's status, and an imprint's own owner over its house's", () => {
    expect(type(image)).toBe("Partner-owned");
    expect(type(skybound)).toBe("Investor-backed");
  });

  it("is null for a house with no owner on record", () => {
    expect(type(boom)).toBeNull();
  });
});
