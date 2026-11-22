import * as fs from 'fs/promises';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────

const MEMORY_SIZE = 256;
const STACK_SIZE = 256;
const CALL_STACK_SIZE = 64;
const MAX_STEPS = 1_000_000;
const MAX_OUTPUT_BYTES = 65_536;

type Word = number; // 32-bit unsigned, but we use signed-uint via >>> 0

enum Trap {
  NONE = 0,
  STACK_UNDERFLOW = 2,
  STACK_OVERFLOW = 3,
  DIV_BY_ZERO = 4,
  BAD_OPCODE = 5,
  MEM_OUT_OF_RANGE = 6,
  CALL_OVERFLOW = 7,
  RET_EMPTY_STACK = 8,
  PC_OUT_OF_PROGRAM = 9,
  STEP_LIMIT = 10,
  OUTPUT_LIMIT = 11,
}

interface VMState {
  stack: number[];
  callStack: number[];
  memory: Uint32Array;
  pc: number;
  output: Uint8Array;
  steps: number;
}

// ─── Opcode helpers ───────────────────────────────────────────────────────

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8)) >>> 0;
}

function readI16(bytes: Uint8Array, offset: number): number {
  const v = readU16(bytes, offset);
  return v >= 0x8000 ? v - 0x10000 : v;
}

function signed32(x: number): number {
  return x | 0;
}

// ─── VM Implementation ────────────────────────────────────────────────────

class TinyStackVM {
  private program: Uint8Array;
  private input: Uint8Array;
  private state: VMState;

  constructor(program: Uint8Array, input: Uint8Array) {
    this.program = program;
    this.input = input;
    this.state = {
      stack: [],
      callStack: [],
      memory: new Uint32Array(MEMORY_SIZE),
      pc: 0,
      output: new Uint8Array(0),
      steps: 0,
    };
  }

  private peekStack(depth: number): number {
    const idx = this.state.stack.length - 1 - depth;
    if (idx < 0) {
      this.trap(Trap.STACK_UNDERFLOW);
      return 0;
    }
    return this.state.stack[idx];
  }

  private popStack(): number {
    if (this.state.stack.length === 0) {
      this.trap(Trap.STACK_UNDERFLOW);
      return 0;
    }
    return this.state.stack.pop()!;
  }

  private pushStack(val: number): void {
    if (this.state.stack.length >= STACK_SIZE) {
      this.trap(Trap.STACK_OVERFLOW);
      return;
    }
    this.state.stack.push(val >>> 0);
  }

  private trap(code: Trap): void {
    if (this.state.stack.length === 0 || this.state.stack[this.state.stack.length - 1] === 0) {
      // Store trap code in a place where it can be retrieved
    }
    // For now, just set a state variable
    (this as any)._trap = code;
    throw new Error(`Trap ${code}`);
  }

  private getTrap(): Trap {
    return (this as any)._trap ?? Trap.NONE;
  }

  private ensureOutput(): void {
    if ((this as any)._trap !== undefined) {
      // If trap occurred, don't continue
    }
  }

  private writeOutput(byte: number): void {
    if (this.state.output.length >= MAX_OUTPUT_BYTES) {
      this.trap(Trap.OUTPUT_LIMIT);
      return;
    }
    const newOutput = new Uint8Array(this.state.output.length + 1);
    newOutput.set(this.state.output);
    newOutput[this.state.output.length] = byte;
    this.state.output = newOutput;
  }

  private readInput(): number {
    // Simplified: in real impl, track input position
    // For now, return 0 if no more input
    return 0;
  }

  private inputPos = 0;

  private readInputByte(): number {
    if (this.inputPos >= this.input.length) {
      return 0;
    }
    return this.input[this.inputPos++] || 0;
  }

  run(): { exitCode: number; trap: Trap; steps: number; output: Uint8Array } {
    this.state = {
      stack: [],
      callStack: [],
      memory: new Uint32Array(MEMORY_SIZE),
      pc: 0,
      output: new Uint8Array(0),
      steps: 0,
    };
    this.inputPos = 0;
    (this as any)._trap = Trap.NONE;

    try {
      while (this.state.steps < MAX_STEPS && this.state.pc < this.program.length) {
        this.state.steps++;

        const opcode = this.program[this.state.pc];

        switch (opcode) {
          case 0x00: // HALT
            return { exitCode: 0, trap: Trap.NONE, steps: this.state.steps, output: this.state.output };

          case 0x01: { // PUSH8
            const val = this.program[this.state.pc + 1];
            this.pushStack(val);
            this.state.pc += 2;
            continue;
          }

          case 0x02: { // PUSH32
            const val = readU32(this.program, this.state.pc + 1);
            this.pushStack(val);
            this.state.pc += 5;
            continue;
          }

          case 0x03: { // POP
            this.popStack();
            this.state.pc += 1;
            continue;
          }

          case 0x04: { // DUP
            const val = this.peekStack(0);
            this.pushStack(val);
            this.state.pc += 1;
            continue;
          }

          case 0x05: { // SWAP
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(b);
            this.pushStack(a);
            this.state.pc += 1;
            continue;
          }

          case 0x06: { // OVER
            const b = this.popStack();
            const a = this.peekStack(0);
            this.pushStack(a);
            this.pushStack(b);
            this.state.pc += 1;
            continue;
          }

          case 0x07: { // ROT
            const c = this.popStack();
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(b);
            this.pushStack(c);
            this.pushStack(a);
            this.state.pc += 1;
            continue;
          }

          case 0x10: { // ADD
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a + b) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x11: { // SUB
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a - b) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x12: { // MUL
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a * b) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x13: { // DIV
            const b = this.popStack();
            const a = this.popStack();
            if (b === 0) {
              this.trap(Trap.DIV_BY_ZERO);
            }
            this.pushStack(signed32(a / b));
            this.state.pc += 1;
            continue;
          }

          case 0x14: { // MOD
            const b = this.popStack();
            const a = this.popStack();
            if (b === 0) {
              this.trap(Trap.DIV_BY_ZERO);
            }
            this.pushStack(signed32(a % b));
            this.state.pc += 1;
            continue;
          }

          case 0x15: { // DIVU
            const b = this.popStack();
            const a = this.popStack();
            if (b === 0) {
              this.trap(Trap.DIV_BY_ZERO);
            }
            this.pushStack(a / b >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x16: { // MODU
            const b = this.popStack();
            const a = this.popStack();
            if (b === 0) {
              this.trap(Trap.DIV_BY_ZERO);
            }
            this.pushStack(a % b >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x17: { // NEG
            const a = this.popStack();
            this.pushStack((-a) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x18: { // AND
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(a & b);
            this.state.pc += 1;
            continue;
          }

          case 0x19: { // OR
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(a | b);
            this.state.pc += 1;
            continue;
          }

          case 0x1a: { // XOR
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(a ^ b);
            this.state.pc += 1;
            continue;
          }

          case 0x1b: { // NOT
            const a = this.popStack();
            this.pushStack(~a >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x1c: { // SHL
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a << (b & 0x1f)) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x1d: { // SHR
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a >>> (b & 0x1f)) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x1e: { // SHRU
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack((a >>> (b & 0x1f)) >>> 0);
            this.state.pc += 1;
            continue;
          }

          case 0x20: { // EQ
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(a === b ? 1 : 0);
            this.state.pc += 1;
            continue;
          }

          case 0x21: { // LT
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(signed32(a) < signed32(b) ? 1 : 0);
            this.state.pc += 1;
            continue;
          }

          case 0x22: { // LTU
            const b = this.popStack();
            const a = this.popStack();
            this.pushStack(a < b ? 1 : 0);
            this.state.pc += 1;
            continue;
          }

          case 0x30: { // JMP
            const offset = readI16(this.program, this.state.pc + 1);
            this.state.pc = (this.state.pc + 1 + offset) >>> 0;
            continue;
          }

          case 0x31: { // JZ
            const offset = readI16(this.program, this.state.pc + 1);
            const val = this.popStack();
            if (val === 0) {
              this.state.pc = (this.state.pc + 1 + offset) >>> 0;
            } else {
              this.state.pc += 3;
            }
            continue;
          }

          case 0x32: { // JNZ
            const offset = readI16(this.program, this.state.pc + 1);
            const val = this.popStack();
            if (val !== 0) {
              this.state.pc = (this.state.pc + 1 + offset) >>> 0;
            } else {
              this.state.pc += 3;
            }
            continue;
          }

          case 0x33: { // CALL
            const addr = readU16(this.program, this.state.pc + 1);
            if (this.state.callStack.length >= CALL_STACK_SIZE) {
              this.trap(Trap.CALL_OVERFLOW);
            }
            this.state.callStack.push(this.state.pc + 3);
            this.state.pc = addr;
            continue;
          }

          case 0x34: { // RET
            if (this.state.callStack.length === 0) {
              this.trap(Trap.RET_EMPTY_STACK);
            }
            this.state.pc = this.state.callStack.pop()!;
            continue;
          }

          case 0x40: { // LOAD
            const addr = this.popStack();
            if (addr >= MEMORY_SIZE) {
              this.trap(Trap.MEM_OUT_OF_RANGE);
            }
            this.pushStack(this.state.memory[addr]);
            this.state.pc += 1;
            continue;
          }

          case 0x41: { // STORE
            const addr = this.popStack();
            const val = this.popStack();
            if (addr >= MEMORY_SIZE) {
              this.trap(Trap.MEM_OUT_OF_RANGE);
            }
            this.state.memory[addr] = val;
            this.state.pc += 1;
            continue;
          }

          case 0x50: { // PRINT (integer to decimal string)
            const val = this.popStack();
            const str = String(signed32(val));
            for (let i = 0; i < str.length; i++) {
              this.writeOutput(str.charCodeAt(i));
            }
            this.state.pc += 1;
            continue;
          }

          case 0x51: { // PUTC
            const val = this.popStack();
            this.writeOutput(val & 0xff);
            this.state.pc += 1;
            continue;
          }

          case 0x52: { // IN
            const val = this.readInputByte();
            this.pushStack(val);
            this.state.pc += 1;
            continue;
          }

          case 0x53: { // EXIT
            const val = this.popStack();
            return { exitCode: val, trap: this.getTrap(), steps: this.state.steps, output: this.state.output };
          }

          default:
            this.trap(Trap.BAD_OPCODE);
            this.state.pc += 1;
            continue;
        }
      }

      // Step limit or PC out of program
      if (this.state.steps >= MAX_STEPS) {
        this.trap(Trap.STEP_LIMIT);
      } else if (this.state.pc >= this.program.length) {
        this.trap(Trap.PC_OUT_OF_PROGRAM);
      }

      return { exitCode: 0, trap: this.getTrap(), steps: this.state.steps, output: this.state.output };

    } catch (err: any) {
      const trap = (this as any)._trap ?? Trap.NONE;
      return { exitCode: 1, trap, steps: this.state.steps, output: this.state.output };
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const inputDir = '/input';
  const outputDir = '/output';

  for (let i = 1; i <= 40; i++) {
    const id = `i${String(i).padStart(3, '0')}`;
    const instanceInputDir = path.join(inputDir, id);
    const instanceOutputDir = path.join(outputDir, id);

    await fs.mkdir(instanceOutputDir, { recursive: true });

    try {
      const programPath = path.join(instanceInputDir, 'program.bin');
      const inputPath = path.join(instanceInputDir, 'input.bin');

      const programBytes = await fs.readFile(programPath);
      const inputBytes = await fs.readFile(inputPath);

      const program = new Uint8Array(programBytes);
      const input = new Uint8Array(inputBytes);

      const vm = new TinyStackVM(program, input);
      const { exitCode, trap, steps, output } = vm.run();

      // Write stdout.bin
      const stdoutPath = path.join(instanceOutputDir, 'stdout.bin');
      await fs.writeFile(stdoutPath, output);

      // Write exit.txt
      const exitPath = path.join(instanceOutputDir, 'exit.txt');
      let exitContent = `${exitCode}\n`;
      if (trap !== Trap.NONE) {
        exitContent += `TRAP:${trap}\n`;
      }
      await fs.writeFile(exitPath, exitContent);
    } catch (err: any) {
      // Handle errors - write error output
      const instanceOutputDir = path.join(outputDir, id);
      await fs.mkdir(instanceOutputDir, { recursive: true });
      await fs.writeFile(path.join(instanceOutputDir, 'stdout.bin'), new Uint8Array(0));
      await fs.writeFile(path.join(instanceOutputDir, 'exit.txt'), `ERROR:${err.message || err}\n`);
    }
  }
}

main().catch(console.error);
