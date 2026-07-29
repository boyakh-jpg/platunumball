import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  getCreateDefaultTeamPlayerIds,
  getCreatePartyPlayerIds,
  getCreatePartyReserveIds,
  getRecruitingDefaultTeamPlayerIds,
  getRecruitingDefaultTeamReserveIds,
  getRecruitingPartyPlayerIds,
  getRecruitingPartyReserveIds,
  getRecruitingTeamRepresentativePlayerIds,
  selectPartyPlayerIds,
  selectPartyReserveIds,
} from "../src/lib/teamPartyRoster.js";

const team = {
  id: "team-a",
  members: [
    { userId: "host", role: "captain" },
    { userId: "party-leader", role: "regular" },
    { userId: "regular", role: "regular" },
    { userId: "reserve", role: "regular" },
  ],
};

test("party roster primitives preserve order, uniqueness, exclusions, and capacity", () => {
  assert.deepEqual(selectPartyPlayerIds({
    eligiblePlayerIds: ["host", "party-leader", "regular"],
    playerIds: ["regular", "invalid", "regular", "party-leader"],
    excludedIds: ["party-leader"],
    capacity: 2,
  }), ["regular"]);
  assert.deepEqual(selectPartyReserveIds({
    eligiblePlayerIds: ["host", "party-leader", "regular", "reserve"],
    reserveIds: ["reserve", "regular", "reserve", "invalid"],
    activeIds: ["regular"],
    excludedIds: ["host"],
    capacity: 2,
  }), ["reserve"]);
});

test("create roster keeps explicit selection and does not inject the host", () => {
  assert.deepEqual(
    getCreatePartyPlayerIds(team, ["regular"], 3),
    ["regular"],
  );
  assert.deepEqual(
    getCreatePartyPlayerIds(team, undefined, 2, ["host"]),
    ["party-leader", "regular"],
  );
});

test("create defaults prefer an available player but never reinsert an excluded player", () => {
  assert.deepEqual(
    getCreateDefaultTeamPlayerIds(team, 3, [], "regular"),
    ["regular", "host", "party-leader"],
  );
  assert.deepEqual(
    getCreateDefaultTeamPlayerIds(team, 2, ["host"], "host"),
    ["party-leader", "regular"],
  );
});

test("create opponent reserves exclude active and owner-side players", () => {
  assert.deepEqual(
    getCreatePartyReserveIds(
      team,
      ["reserve", "regular", "host", "reserve"],
      ["regular"],
      3,
      ["host"],
    ),
    ["reserve"],
  );
  assert.deepEqual(
    getCreatePartyReserveIds(team, ["reserve", "regular", "party-leader", "host"]),
    ["reserve", "regular", "party-leader"],
  );
});

test("recruiting join keeps the required party leader first even from an empty selection", () => {
  assert.deepEqual(
    getRecruitingPartyPlayerIds(team, [], 3, "party-leader"),
    ["party-leader"],
  );
  assert.deepEqual(
    getRecruitingPartyPlayerIds(team, ["regular"], 3, "party-leader"),
    ["party-leader", "regular"],
  );
});

test("recruiting host, regular, and reserve paths retain their current contracts", () => {
  assert.deepEqual(
    getRecruitingDefaultTeamPlayerIds(team, 3, "host"),
    ["host", "party-leader", "regular"],
  );
  assert.deepEqual(
    getRecruitingTeamRepresentativePlayerIds(team, "host"),
    ["host"],
  );
  assert.deepEqual(
    getRecruitingTeamRepresentativePlayerIds(team, "outsider"),
    [],
  );
  assert.deepEqual(
    getRecruitingPartyReserveIds(team, ["regular", "reserve"], ["regular"], 2),
    ["reserve"],
  );
  assert.deepEqual(
    getRecruitingDefaultTeamReserveIds(team, ["host", "party-leader"], 2),
    ["regular", "reserve"],
  );
});

test("CreateMatch and Recruiting consume the central roster contracts", () => {
  const createSource = fs.readFileSync(new URL("../src/pages/CreateMatch.jsx", import.meta.url), "utf8");
  const recruitingSource = fs.readFileSync(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8");

  assert.match(createSource, /from "\.\.\/lib\/teamPartyRoster\.js"/);
  assert.doesNotMatch(createSource, /function get(?:DefaultTeam|Party)PlayerIds/);
  assert.doesNotMatch(createSource, /function getPartyReserveIds/);
  assert.match(recruitingSource, /from "\.\.\/lib\/teamPartyRoster\.js"/);
  assert.doesNotMatch(recruitingSource, /function get(?:DefaultTeam|Party)PlayerIds/);
  assert.doesNotMatch(recruitingSource, /function getPartyReserveIds/);
  assert.match(recruitingSource, /roomPhaseViewModel\.mode === ROOM_BODY_MODES\.pickupPool/);
  assert.match(recruitingSource, /teamOnlyRoom[\s\S]*?app\.currentUser\.id \? \[app\.currentUser\.id\] : \[\]/);
});
