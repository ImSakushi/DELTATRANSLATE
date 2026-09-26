import assert from "node:assert/strict";
import test from "node:test";
import { describePublication, effectiveState, summarizePublication } from "./src/runedelta-publication.mjs";

const publication = {
  ok: true,
  branch: "Alex",
  counts: { published: 2, pushed: 1, local: 1, incoming: 3 },
  keys: {
    main: { state: "published", event: { commit: "a".repeat(40), at: Date.UTC(2026, 8, 21, 18), by: "Tick358", summary: "Merge pull request #82 from Equipe/Alex-3", pr: 82, from: "Alex-3" } },
    branch: { state: "pushed", mainChanged: true, event: { commit: "b".repeat(40), at: Date.UTC(2026, 8, 20), by: "Alex", summary: "trad(ch5): traduire 2 dialogues" } },
    incoming: { state: "incoming", event: { commit: "c".repeat(40), at: Date.UTC(2026, 8, 22), by: "Tick358", summary: "Merge pull request #83 from Equipe/Evil", pr: 83, from: "Evil" } },
  },
};

test("une modification non enregistrée rend toujours la ligne non publiée", () => {
  assert.equal(effectiveState(publication, "main", true), "local");
  assert.equal(effectiveState(publication, "main"), "published");
  assert.equal(effectiveState(publication, "inconnue"), null);
  assert.equal(describePublication(publication, "main", true).state, "local");
});

test("décrit la PR de main, la branche en attente et les nouveautés à récupérer", () => {
  assert.match(describePublication(publication, "main").text, /^✓ Publiée dans main le .+ via PR #82 \(Alex-3\)$/);
  const pushed = describePublication(publication, "branch");
  assert.match(pushed.text, /^↑ Publiée sur Alex le .+ en attente de fusion dans main$/);
  assert.match(pushed.tooltip, /main contient une autre version/);
  assert.match(describePublication(publication, "incoming").text, /via PR #83 \(Evil\)$/);
  assert.match(describePublication(publication, "incoming").tooltip, /Récupérer/);
});

test("le résumé compte aussi les lignes non enregistrées", () => {
  assert.equal(summarizePublication(publication, 2),
    "3 non publiées · 1 sur Alex, pas encore dans main · 3 nouveautés de main à récupérer · 2 publiées dans main");
  assert.equal(summarizePublication({ ok: false }), "");
});
