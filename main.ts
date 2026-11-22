// Tiny Stack VM - make.fun competition
// Implements the tiny stack ISA (program/generator/subject/ISA.md)
// Reference: program/generator/subject/vm.mjs

const STACK_MAX = 256, CALLS_MAX = 64, MEMORY_WORDS = 256;
const STEP_LIMIT = 1000000, OUTPUT_MAX = 65536;
const TRAP = {U:2, O:3, D:4, B:5, M:6, C:7, R:8, P:9, S:10, O2:11};

const OPS = [
  [0x00,'HALT',0,0,0],[0x01,'PUSH8',1,0,1],[0x02,'PUSH32',4,0,1],
  [0x03,'POP',0,1,0],[0x04,'DUP',0,1,2],[0x05,'SWAP',0,2,2],
  [0x06,'OVER',0,2,3],[0x07,'ROT',0,3,3],
  [0x10,'ADD',0,2,1],[0x11,'SUB',0,2,1],[0x12,'MUL',0,2,1],
  [0x13,'DIV',0,2,1],[0x14,'MOD',0,2,1],[0x15,'DIVU',0,2,1],
  [0x16,'MODU',0,2,1],[0x17,'NEG',0,1,1],[0x18,'AND',0,2,1],
  [0x19,'OR',0,2,1],[0x1a,'XOR',0,2,1],[0x1b,'NOT',0,1,1],
  [0x1c,'SHL',0,2,1],[0x1d,'SHR',0,2,1],[0x1e,'SHRU',0,2,1],
  [0x20,'EQ',0,2,1],[0x21,'LT',0,2,1],[0x22,'LTU',0,2,1],
  [0x30,'JMP',2,0,0],[0x31,'JZ',2,1,0],[0x32,'JNZ',2,1,0],
  [0x33,'CALL',2,0,0],[0x34,'RET',0,0,0],
  [0x40,'LOAD',0,1,1],[0x41,'STORE',0,2,0],
  [0x50,'PRINT',0,1,0],[0x51,'PUTC',0,1,0],[0x52,'IN',0,0,1],[0x53,'EXIT',0,1,0]
];
const OP = new Map(OPS.map(([b])=>[b,OPS.find(o=>o[0]===b)]));

function run(prog: Uint8Array, inp: Uint8Array): {stdout: Uint8Array, exit: number, trap: number|null, steps: number} {
  const n = prog.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let csp = 0;
  const M = new Int32Array(MEMORY_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0, ip = 0, pc = 0, steps = 0;
  const enc = new TextEncoder();
  const done = (e, t) => ({stdout: out.slice(0, olen), exit: e, trap: t, steps});
  const ctrap = (c) => done(c, c);
  
  for (;;) {
    if (steps++ === STEP_LIMIT) return ctrap(TRAP.S);
    if (pc < 0 || pc >= n) return ctrap(TRAP.P);
    const op = OP.get(prog[pc]);
    if (!op) return ctrap(TRAP.B);
    const [, , imm, pops, pushes] = op;
    if (pc + imm >= n) return ctrap(TRAP.P);
    const next = pc + 1 + imm;
    if (sp < pops) return ctrap(TRAP.U);
    if (sp - pops + pushes > STACK_MAX) return ctrap(TRAP.O);
    pc = next;
    switch (op[1]) {
      case 'HALT': return done(0, null);
      case 'PUSH8': D[sp++] = (prog[next-1]<<24)>>24; break;
      case 'PUSH32': D[sp++] = prog[next-4]|(prog[next-3]<<8)|(prog[next-2]<<16)|(prog[next-1]<<24); break;
      case 'POP': sp--; break;
      case 'DUP': D[sp]=D[sp-1]; sp++; break;
      case 'SWAP': { const t=D[sp-1]; D[sp-1]=D[sp-2]; D[sp-2]=t; } break;
      case 'OVER': D[sp]=D[sp-2]; sp++; break;
      case 'ROT': { const a=D[sp-3]; D[sp-3]=D[sp-2]; D[sp-2]=D[sp-1]; D[sp-1]=a; } break;
      case 'NEG': D[sp-1]=-D[sp-1]|0; break;
      case 'NOT': D[sp-1]=~D[sp-1]; break;
      case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': case 'DIVU': case 'MODU':
      case 'AND': case 'OR': case 'XOR': case 'SHL': case 'SHR': case 'SHRU':
      case 'EQ': case 'LT': case 'LTU': {
        const b=D[sp-1], a=D[sp-2];
        let r: number;
        switch (op[1]) {
          case 'ADD': r=(a+b)|0; break;
          case 'SUB': r=(a-b)|0; break;
          case 'MUL': r=Math.imul(a,b); break;
          case 'DIV': if(b===0)return ctrap(TRAP.D); r=a===-2147483648&&b===-1?a:(a/b)|0; break;
          case 'MOD': if(b===0)return ctrap(TRAP.D); r=b===-1?0:a%b|0; break;
          case 'DIVU': if(b===0)return ctrap(TRAP.D); r=Math.floor((a>>>0)/(b>>>0))|0; break;
          case 'MODU': if(b===0)return ctrap(TRAP.D); r=(a>>>0)%(b>>>0)|0; break;
          case 'AND': r=a&b; break;
          case 'OR': r=a|b; break;
          case 'XOR': r=a^b; break;
          case 'SHL': r=a<<(b&31); break;
          case 'SHR': r=a>>(b&31); break;
          case 'SHRU': r=(a>>>(b&31))|0; break;
          case 'EQ': r=a===b?1:0; break;
          case 'LT': r=a<b?1:0; break;
          case 'LTU': r=a>>>0<b>>>0?1:0; break;
        }
        sp-=2; D[sp++]=r; break;
      }
      case 'JMP': case 'JZ': case 'JNZ': {
        const rel=((prog[next-2]|(prog[next-1]<<8))<<16)>>16;
        let take=true;
        if (op[1]!=='JMP') { const v=D[--sp]; take=op[1]==='JZ'?v===0:v!==0; }
        if (take) pc=next+rel;
        break;
      }
      case 'CALL': if(csp===CALLS_MAX)return ctrap(TRAP.C); C[csp++]=next; pc=prog[next-2]|(prog[next-1]<<8); break;
      case 'RET': if(csp===0)return ctrap(TRAP.R); pc=C[--csp]; break;
      case 'LOAD': { const a=D[sp-1]; if(a<0||a>=MEMORY_WORDS)return ctrap(TRAP.M); D[sp-1]=M[a]; break; }
      case 'STORE': { const a=D[sp-1], v=D[sp-2]; if(a<0||a>=MEMORY_WORDS)return ctrap(TRAP.M); sp-=2; M[a]=v; break; }
      case 'PRINT': { const b=enc.encode(String(D[sp-1])); if(olen+b.length>OUTPUT_MAX)return ctrap(TRAP.O2); sp--; out.set(b,olen); olen+=b.length; break; }
      case 'PUTC': { if(olen+1>OUTPUT_MAX)return ctrap(TRAP.O2); out[olen++]=D[--sp]&255; break; }
      case 'IN': D[sp++]=ip<inp.length?inp[ip++]:-1; break;
      case 'EXIT': return done(D[--sp]&255, null);
    }
  }
}

async function main() {
  const fs = require('fs');
  const path = require('path');
  for (let i = 1; i <= 40; i++) {
    const id = 'i' + String(i).padStart(3, '0');
    const prog = fs.readFileSync(path.join('/input', id, 'program.bin'));
    const inp = fs.readFileSync(path.join('/input', id, 'input.bin'));
    const result = run(new Uint8Array(prog), new Uint8Array(inp));
    const outDir = path.join('/output', id);
    fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(path.join(outDir, 'stdout.bin'), result.stdout);
    fs.writeFileSync(path.join(outDir, 'exit.txt'), String(result.exit));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
