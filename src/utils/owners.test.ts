import { describe, expect, it } from "vitest";
import type { Owner, Publisher } from "../types";
import { buildPublisherIndex } from "./publishers";
import { buildOwnershipIndex, describeLink, ownershipChain } from "./owners";

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
