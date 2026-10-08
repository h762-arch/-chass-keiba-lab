import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTicketLine, evaluateTicketPool } from '../src/research/nar-ticket-engine-v1.mjs';

function passLine(partner, extra = {}) {
  return {
    anchor: '#13 ペルセイズ',
    partner,
    pairDecision: 'PASS',
    stopClass: 'N/A',
    swapRequested: false,
    swapGate: 'N/A',
    ...extra,
  };
}

function freezeReady(lines, extra = {}) {
  return {
    raceId: '20261008_OI_10',
    ticketType: 'WIDE',
    lines,
    identityStatus: 'PASS',
    leakageGuard: 'PASS',
    preResultOnly: true,
    beforeOffTime: true,
    ...extra,
  };
}

test('explicit PASS lines can reach pool PASS and shadow freeze eligibility', () => {
  const result = evaluateTicketPool(freezeReady([
    passLine('#5 ランニングビーチ'),
    passLine('#10 ウインアイリーン'),
  ]));
  assert.equal(result.poolDecision, 'PASS');
  assert.equal(result.freezeEligible, true);
  assert.equal(result.freezeDecision, 'ELIGIBLE_SHADOW_ONLY');
  assert.equal(result.executedStatus, 'NOT_EXECUTED');
  assert.equal(result.adopted, false);
});

test('UNKNOWN pair evidence never becomes PASS', () => {
  const line = evaluateTicketLine({ anchor: 6, partner: 2, stopClass: 'N/A' });
  assert.equal(line.pairDecision, 'UNKNOWN');
  assert.equal(line.lineDecision, 'HOLD');
  assert.equal(line.reason, 'PAIR_DECISION_UNKNOWN');
});

test('CONTINUE_TARGETED never promotes a HOLD pair', () => {
  const line = evaluateTicketLine({
    anchor: 13,
    partner: 10,
    pairDecision: 'HOLD',
    stopClass: 'CONTINUE_TARGETED',
  });
  assert.equal(line.lineDecision, 'HOLD');
  assert.equal(line.reason, 'PAIR_HOLD_CONTINUE_TARGETED');
});

test('closed stop classes preserve HOLD rather than inventing REJECT or PASS', () => {
  for (const stopClass of [
    'STOP_STRUCTURAL',
    'STOP_DIRECT_NEGATIVE',
    'STOP_CURRENT_GATE',
    'STOP_SWAP_CLOSED',
    'STOP_LOW_MARGINAL',
    'STOP_SOURCE_EXHAUSTED',
  ]) {
    const line = evaluateTicketLine({
      anchor: 4,
      partner: 8,
      pairDecision: 'HOLD',
      stopClass,
    });
    assert.equal(line.lineDecision, 'HOLD');
    assert.equal(line.reason, `STOP_RULE_${stopClass}`);
  }
});

test('Pair REJECT is the only path to line REJECT', () => {
  const line = evaluateTicketLine({
    anchor: 4,
    partner: 8,
    pairDecision: 'REJECT',
    stopClass: 'N/A',
  });
  assert.equal(line.lineDecision, 'REJECT');
  assert.equal(line.reason, 'PAIR_REJECT');
});

test('a requested swap with UNKNOWN gate fails closed', () => {
  const line = evaluateTicketLine(passLine('#1 ドライブミーホーム', {
    origin: 'SWAP_IN',
    swapRequested: true,
    swapGate: 'UNKNOWN',
  }));
  assert.equal(line.lineDecision, 'HOLD');
  assert.equal(line.reason, 'SWAP_GATE_UNKNOWN');
});

test('a requested swap resolved NO_SWAP cannot enter the pool', () => {
  const line = evaluateTicketLine(passLine('#1 ドライブミーホーム', {
    origin: 'SWAP_IN',
    swapRequested: true,
    swapGate: 'NO_SWAP',
  }));
  assert.equal(line.lineDecision, 'HOLD');
  assert.equal(line.reason, 'SWAP_NOT_AUTHORIZED');
});

test('a requested swap requires explicit PASS', () => {
  const line = evaluateTicketLine(passLine('#14 エコロレーヴ', {
    origin: 'SWAP_IN',
    swapRequested: true,
    swapGate: 'PASS',
  }));
  assert.equal(line.lineDecision, 'PASS');
});

test('one Pair PASS does not validate a four-line ticket pool', () => {
  const result = evaluateTicketPool(freezeReady([
    passLine('#5 ランニングビーチ'),
    { anchor: '#13 ペルセイズ', partner: '#10 ウインアイリーン', pairDecision: 'HOLD', stopClass: 'STOP_SOURCE_EXHAUSTED' },
    { anchor: '#13 ペルセイズ', partner: '#3 エスプリボクチャン', pairDecision: 'HOLD', stopClass: 'STOP_CURRENT_GATE' },
    { anchor: '#13 ペルセイズ', partner: '#1 ドライブミーホーム', pairDecision: 'HOLD', stopClass: 'STOP_SWAP_CLOSED', swapRequested: true, swapGate: 'NO_SWAP' },
  ]));
  assert.equal(result.pairPassCount, 1);
  assert.equal(result.pairHoldCount, 3);
  assert.equal(result.poolDecision, 'HOLD');
  assert.equal(result.freezeEligible, false);
});

test('identity failure blocks Freeze after a pool PASS', () => {
  const result = evaluateTicketPool(freezeReady([passLine('#5')], { identityStatus: 'HOLD' }));
  assert.equal(result.poolDecision, 'PASS');
  assert.equal(result.freezeEligible, false);
  assert.deepEqual(result.freezeFailures, ['IDENTITY_NOT_PASS']);
});

test('leakage uncertainty blocks Freeze after a pool PASS', () => {
  const result = evaluateTicketPool(freezeReady([passLine('#5')], { leakageGuard: 'UNKNOWN' }));
  assert.equal(result.poolDecision, 'PASS');
  assert.equal(result.freezeEligible, false);
  assert.deepEqual(result.freezeFailures, ['LEAKAGE_GUARD_NOT_PASS']);
});

test('post-result or off-time uncertainty blocks Freeze', () => {
  const result = evaluateTicketPool(freezeReady([passLine('#5')], {
    preResultOnly: false,
    beforeOffTime: false,
  }));
  assert.equal(result.freezeEligible, false);
  assert.deepEqual(result.freezeFailures, [
    'PRE_RESULT_ONLY_NOT_CONFIRMED',
    'BEFORE_OFF_TIME_NOT_CONFIRMED',
  ]);
});

test('no ticket lines cannot pass a pool', () => {
  const result = evaluateTicketPool(freezeReady([]));
  assert.equal(result.poolDecision, 'HOLD');
  assert.equal(result.poolReason, 'NO_TICKET_LINES');
  assert.equal(result.freezeEligible, false);
});

test('contradictory PASS pair plus closed stop class fails closed', () => {
  const line = evaluateTicketLine(passLine('#5', { stopClass: 'STOP_SOURCE_EXHAUSTED' }));
  assert.equal(line.lineDecision, 'HOLD');
  assert.equal(line.reason, 'STOP_RULE_CONTRADICTS_PAIR_PASS');
});

test('engine evaluation does not mutate the caller input', () => {
  const input = freezeReady([
    passLine('#5'),
    { anchor: '#13', partner: '#10', pairDecision: 'HOLD', stopClass: 'CONTINUE_TARGETED' },
  ]);
  const before = structuredClone(input);
  const result = evaluateTicketPool(input);
  assert.deepEqual(input, before);
  assert.equal(result.inputUnchanged, true);
  assert.equal(result.freezeMutation, 'NONE');
});

test('missing Stop Rule never defaults to N/A or grants PASS', () => {
  const line=passLine('#5');delete line.stopClass;
  const out=evaluateTicketLine(line);
  assert.equal(out.stopClass,'UNKNOWN');assert.equal(out.lineDecision,'HOLD');
});

test('missing swap request never becomes an authorized non-swap', () => {
  const line=passLine('#5');delete line.swapRequested;
  assert.equal(evaluateTicketLine(line).reason,'SWAP_CONTRACT_UNCONFIRMED');
});

test('non-swap requires an explicit N/A gate even if pair evidence passes', () => {
  for(const gate of [undefined,'UNKNOWN','PASS','NO_SWAP']){
    const out=evaluateTicketLine(passLine('#5',{swapGate:gate}));
    assert.equal(out.lineDecision,'HOLD');assert.equal(out.reason,'SWAP_CONTRACT_UNCONFIRMED');
  }
});

test('contradictory non-swap boolean and swap origin cannot bypass SwapGate', () => {
  const out=evaluateTicketLine(passLine('#5',{origin:'SWAP_IN',swapRequested:false,swapGate:'N/A'}));
  assert.equal(out.lineDecision,'HOLD');assert.equal(out.reason,'SWAP_GATE_UNKNOWN');
});

test('null or malformed pool and line inputs remain HOLD without throwing', () => {
  for(const input of [null,[],42])assert.equal(evaluateTicketPool(input).freezeEligible,false);
  for(const line of [null,[],42])assert.equal(evaluateTicketLine(line).lineDecision,'HOLD');
});

test('missing request on one otherwise PASS line blocks the entire pool', () => {
  const lines=[passLine('#5'),passLine('#10')];delete lines[1].swapRequested;
  const out=evaluateTicketPool(freezeReady(lines));assert.equal(out.poolDecision,'HOLD');assert.equal(out.freezeEligible,false);
});
