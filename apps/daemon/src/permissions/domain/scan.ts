/**
 * Issue #3593: how much work one command line may cost the risk rules. Pure: counters over the words and
 * re-reads the rules ask for, with no clock.
 */
/** The most words read after a program that is a variable: matching them against every verb grows with the square of their number. */
const MAX_WORDS_AFTER_VARIABLE = 256;

/** The most words of one command that are read: the rules match each start word against all that follows, so the work grows with the square of the count. */
const MAX_SEGMENT_WORDS = 4096;

/** The longest command line that is read at all: every rule walks the text, so the work grows with its size. */
const MAX_LINE_CHARS = 100_000;

/** The most words one line may have read in all, each word counted once for every time a rule reads the command that holds it. */
const MAX_WORDS_READ = 100_000;

/** The most variable programs in a row that are read as the start of a command each: every one reads all that follows it. */
const MAX_VARIABLE_CHAIN = 16;

/** How many times one line may be read again inside itself (a shell's text, a substitution, a `find -exec` command). */
const MAX_REREADS = 1024;

/**
 * The work one command line may cost (#3593). Each read of a part of the line inside the line (the text of
 * `sh -c`, a process substitution, a `find -exec` command) spends one of a fixed number of re-reads, so nesting
 * that doubles the work at every level (`sh -c 'sh -c '...`) stops at a known size. A command with more words
 * than the rules can match in bounded time, a chain of variable programs, and a line whose commands add up to
 * more words read than a fixed total are cut the same way. Whatever is cut leaves `spent` set, and the caller
 * rates the line high.
 */
export class Scan {
  private left = MAX_REREADS;
  spent = false;

  private words = MAX_WORDS_READ;

  private cut(words: string[], max: number): string[] {
    if (words.length <= max) return words;
    this.spent = true;
    return words.slice(0, max);
  }

  /** The words after a program that is a variable; more than the rules match in bounded time are cut off. */
  afterVariable(words: string[]): string[] {
    return this.cut(words, MAX_WORDS_AFTER_VARIABLE);
  }

  /** The words of one command as read, before they are tidied: more than twice the most that are read are cut off, and none are read once the line's total is gone. */
  within(raw: string[]): string[] {
    return this.words < 0 ? [] : this.cut(raw, 2 * MAX_SEGMENT_WORDS);
  }

  /**
   * The words of one command, tidied by `tidy` and cut to the most that are read, then charged to the line's
   * total; undefined when the total is gone. The raw words are cut first, so a tidy pass never walks a word
   * list the cut would throw away.
   */
  segment(raw: string[], tidy: (words: string[]) => string[]): string[] | undefined {
    const kept = this.cut(tidy(this.within(raw)), MAX_SEGMENT_WORDS);
    return this.spend(kept.length) ? kept : undefined;
  }

  /** Whether a read of `count` words fits in what is left of the line's total; the first refusal marks the line as spent. */
  spend(count: number): boolean {
    this.words -= Math.max(count, 1);
    if (this.words >= 0) return true;
    this.spent = true;
    return false;
  }

  /** Whether a variable program may be followed by another one at this depth of the chain (`$a $b $c ...`). */
  chained(depth: number): boolean {
    if (depth < MAX_VARIABLE_CHAIN) return true;
    this.spent = true;
    return false;
  }

  /** A line longer than the rules read: nothing of it is read, and the line is spent. */
  tooLong(text: string): boolean {
    if (text.length <= MAX_LINE_CHARS) return false;
    this.spent = true;
    return true;
  }

  /** Whether one more re-read is allowed; the first refusal marks the line as spent. */
  reread(): boolean {
    if (this.left > 0) {
      this.left--;
      return true;
    }
    this.spent = true;
    return false;
  }
}

/** Why a line that spent its re-reads is high: it is not read as routine. */
export const UNREADABLE =
  "a command line too tangled to read in bounded time (nested shells, process substitutions, find -exec, a chain of variable programs or a very large number of words or characters), so it is not read as routine";
