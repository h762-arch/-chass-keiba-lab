const PAIR_DECISIONS = new Set(['PASS', 'HOLD', 'REJECT']);
const SWAP_DECISIONS = new Set(['PASS', 'NO_SWAP', 'N/A']);
const STOP_CLASSES = new Set([
  'N/A',
  'CONTINUE_TARGETED',
  'STOP_STRUCTURAL',
  'STOP_DIRECT_NEGATIVE',
  'STOP_CURRENT_GATE',
  'STOP_SWAP_CLOSED',
  'STOP_LOW_MARGINAL',
  'STOP_SOURCE_EXHAUSTED',
]);

const CLOSED_STOP_CLASSES = new Set([
  'STOP_STRUCTURAL',
  'STOP_DIRECT_NEGATIVE',
  'STOP_CURRENT_GATE',
  'STOP_SWAP_CLOSED',
  'STOP_LOW_MARGINAL',
  'STOP_SOURCE_EXHAUSTED',
]);

function token(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function immutableView(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function lineId(line, index) {
  const anchor = line?.anchor ?? '?';
  const partner = line?.partner ?? `line-${index + 1}`;
  return `${anchor}x${partner}`;
}

export function evaluateTicketLine(line = {}, index = 0) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) line = {};
  const id = lineId(line, index);
  const pairDecision = token(line.pairDecision);
  const stopClass = token(line.stopClass);
  const swapRequested = line.swapRequested === true || token(line.origin) === 'SWAP_IN';
  const swapGate = token(line.swapGate);

  const base = {
    lineId: id,
    pairDecision: PAIR_DECISIONS.has(pairDecision) ? pairDecision : 'UNKNOWN',
    stopClass: STOP_CLASSES.has(stopClass) ? stopClass : 'UNKNOWN',
    swapRequested,
    swapGate: SWAP_DECISIONS.has(swapGate) ? swapGate : 'UNKNOWN',
    lineDecision: 'HOLD',
    reason: 'PAIR_DECISION_UNKNOWN',
  };

  if (pairDecision === 'REJECT') {
    return { ...base, lineDecision: 'REJECT', reason: 'PAIR_REJECT' };
  }

  if (pairDecision !== 'PASS') {
    if (CLOSED_STOP_CLASSES.has(stopClass)) {
      return { ...base, reason: `STOP_RULE_${stopClass}` };
    }
    if (stopClass === 'CONTINUE_TARGETED') {
      return { ...base, reason: 'PAIR_HOLD_CONTINUE_TARGETED' };
    }
    if (!STOP_CLASSES.has(stopClass)) {
      return { ...base, reason: 'STOP_RULE_UNKNOWN' };
    }
    return { ...base, reason: pairDecision === 'HOLD' ? 'PAIR_HOLD' : 'PAIR_DECISION_UNKNOWN' };
  }

  // A stop rule can never promote a non-PASS pair. For an already PASS pair,
  // only N/A is valid; a closed/continue classification is contradictory and
  // therefore fails closed.
  if (stopClass !== 'N/A') {
    return { ...base, reason: 'STOP_RULE_CONTRADICTS_PAIR_PASS' };
  }

  if (typeof line.swapRequested !== 'boolean' ||
      (!swapRequested && swapGate !== 'N/A')) {
    return { ...base, reason: 'SWAP_CONTRACT_UNCONFIRMED' };
  }

  if (swapRequested) {
    if (swapGate === 'NO_SWAP') {
      return { ...base, reason: 'SWAP_NOT_AUTHORIZED' };
    }
    if (swapGate !== 'PASS') {
      return { ...base, reason: 'SWAP_GATE_UNKNOWN' };
    }
  }

  return {
    ...base,
    lineDecision: 'PASS',
    reason: 'PAIR_AND_LINE_GATES_PASS',
  };
}

export function evaluateTicketPool(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const original = immutableView(input);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const evaluatedLines = lines.map((line, index) => evaluateTicketLine(line, index));

  const rejected = evaluatedLines.filter((line) => line.lineDecision === 'REJECT');
  const held = evaluatedLines.filter((line) => line.lineDecision === 'HOLD');
  const passed = evaluatedLines.filter((line) => line.lineDecision === 'PASS');

  let poolDecision = 'HOLD';
  let poolReason = 'NO_TICKET_LINES';
  if (lines.length > 0 && rejected.length > 0) {
    poolDecision = 'REJECT';
    poolReason = 'PAIR_LINE_REJECTED';
  } else if (lines.length > 0 && held.length === 0 && passed.length === lines.length) {
    poolDecision = 'PASS';
    poolReason = 'ALL_INTENDED_LINES_PASS';
  } else if (lines.length > 0) {
    poolReason = 'ONE_OR_MORE_LINES_NOT_PASS';
  }

  const identityStatus = token(input.identityStatus);
  const leakageGuard = token(input.leakageGuard);
  const preResultOnly = input.preResultOnly === true;
  const beforeOffTime = input.beforeOffTime === true;

  const freezeFailures = [];
  if (poolDecision !== 'PASS') freezeFailures.push('POOL_NOT_PASS');
  if (identityStatus !== 'PASS') freezeFailures.push('IDENTITY_NOT_PASS');
  if (leakageGuard !== 'PASS') freezeFailures.push('LEAKAGE_GUARD_NOT_PASS');
  if (!preResultOnly) freezeFailures.push('PRE_RESULT_ONLY_NOT_CONFIRMED');
  if (!beforeOffTime) freezeFailures.push('BEFORE_OFF_TIME_NOT_CONFIRMED');

  const freezeEligible = freezeFailures.length === 0;

  return {
    engineVersion: 'CHASS_NAR_TICKET_ENGINE_STOP_RULE_V1',
    researchOnly: true,
    adopted: false,
    formalKpiEligible: false,
    raceId: input.raceId ?? null,
    ticketType: input.ticketType ?? null,
    poolDecision,
    poolReason,
    pairPassCount: passed.length,
    pairHoldCount: held.length,
    pairRejectCount: rejected.length,
    lineCount: lines.length,
    lines: evaluatedLines,
    freezeEligible,
    freezeDecision: freezeEligible ? 'ELIGIBLE_SHADOW_ONLY' : 'HOLD',
    freezeFailures,
    freezeMutation: 'NONE',
    executedStatus: 'NOT_EXECUTED',
    inputUnchanged: JSON.stringify(original) === JSON.stringify(input),
  };
}

export const __ticketEngineContract = Object.freeze({
  pairDecisions: Object.freeze([...PAIR_DECISIONS]),
  swapDecisions: Object.freeze([...SWAP_DECISIONS]),
  stopClasses: Object.freeze([...STOP_CLASSES]),
  closedStopClasses: Object.freeze([...CLOSED_STOP_CLASSES]),
});
