/**
 * Pattern layer ported from ward (codes/ward/firewall/src/firewall.ts), trimmed to the short,
 * owner-written text CHOG World accepts (nickname and personality). That text reaches the decider
 * prompt, so anything that reads like instructions to a model is refused outright.
 * The decider can only ever pick from legal candidates, so this is defence in depth, not the fence.
 */

interface Sig {
  id: string;
  re: RegExp;
}

const SIGNATURES: Sig[] = [
  { id: "override.ignore_previous", re: /ignore\s+(all\s+|any\s+|the\s+)?(your\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|messages?|context|rules?)/i },
  { id: "override.disregard", re: /disregard\s+(all\s+|the\s+|your\s+|any\s+)?(previous|prior|above|system|safety|earlier)/i },
  { id: "override.forget", re: /forget\s+(everything|all|what|your\s+(instructions|prompt|rules|guidelines))/i },
  { id: "override.new_instructions", re: /(new|updated|revised|real|true|actual)\s+(instructions?|task|directive|system\s*prompt)\s*[:=]/i },
  { id: "override.ignore_bare", re: /\bignore\s+(your|my|the|these|those|its)\s+(instructions?|prompts?|rules?|guidelines?|directives?|system\s*prompt)\b/i },
  { id: "spoof.role_marker", re: /(^|\n)\s*(system|assistant|developer|user)\s*[:：]\s*\S/i },
  { id: "spoof.chat_tags", re: /<\|?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<<\/?SYS>>|<\/?personality>/i },
  { id: "spoof.you_are_now", re: /you\s+are\s+now\s+(a|an|the|in|operating|no\s+longer|free|unrestricted|DAN)/i },
  { id: "exfil.reveal_prompt", re: /(reveal|print|show|repeat|output|expose)\s+(me\s+)?(your\s+)?(system\s+)?(prompt|instructions?|rules|api\s*key|secret)/i },
  { id: "action.pick_option", re: /\b(always|only)\s+(pick|choose|select)\b|\b(pick|choose|select)\s+(option|candidate|id)\b|\b(quest|attack|buy|use)-\d+/i },
  { id: "action.move_funds", re: /\b(transfer|send|approve|withdraw|drain|sweep)\s+(all\s+|the\s+|your\s+|my\s+)?(funds?|chog|tokens?|balance|wallet|assets?)\b/i },
  { id: "action.address", re: /0x[a-fA-F0-9]{40}/ },
  { id: "action.tool_tag", re: /<\/?(tool_call|function_call|invoke)\b|"tool_calls"\s*:/i },
  { id: "redirect.instead", re: /\binstead\s*,?\s+(do|output|return|respond\s+with|say|print|execute|call|send|reply)\b/i },
  { id: "obf.zero_width", re: /[​-‍⁠﻿]/ },
  { id: "obf.long_base64", re: /[A-Za-z0-9+/]{60,}={0,2}/ },
];

export interface ScreenResult {
  ok: boolean;
  hits: string[];
}

export function screen(text: string): ScreenResult {
  const hits = SIGNATURES.filter((s) => s.re.test(text)).map((s) => s.id);
  return { ok: hits.length === 0, hits };
}

/** Collapse whitespace and strip control characters before storing. */
export function normalize(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}
