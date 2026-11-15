import { describe, expect, test } from "bun:test";
import {
  AZ_CUT_NOTE,
  AZ_TEXT_FLAGS,
  azText,
  mapSpawnError,
  sanitizeAzArgs,
} from "../../src/pr/domain/az-text.ts";

/** What the Windows .cmd shim refuses: a newline and these characters. */
const REFUSED = /[\r\n<>&|^"%]/;
const NASTY = [
  "linha 1\nlinha 2\r\nlinha 3",
  'diz "oi" <b>negrito</b> & mais | pipe ^ acento 100%',
  "texto\n\n\nem várias linhas  com   espaços\t\te tabs",
  "<script>alert(1)</script>",
  "a%PATH%b",
];

describe("az-cmd", () => {
  test("uma linha só: quebras viram ' — ' e os espaços repetidos se juntam", () => {
    expect(azText("a\nb", 400)).toBe("a — b");
    expect(azText("a\r\n\r\n\r\nb", 400)).toBe("a — b");
    expect(azText("a \n b", 400)).toBe("a — b");
    expect(azText("\n\n  a\n", 400)).toBe("a");
    expect(azText("a   b\t\t c", 400)).toBe("a b c");
  });

  test("os caracteres que o Bun recusa no .cmd saem ou viram equivalentes seguros", () => {
    expect(azText("<x>", 400)).toBe("(x)");
    expect(azText("a & b", 400)).toBe("a e b");
    expect(azText("a|b", 400)).toBe("a/b");
    expect(azText("5^2", 400)).toBe("52");
    expect(azText('diz "oi"', 400)).toBe("diz 'oi'");
    expect(azText("100%", 400)).toBe("100");
    for (const text of NASTY) expect(REFUSED.test(azText(text, 400))).toBe(false);
  });

  test("o az lê arquivo de argumento que começa com @ ou tem =@: o texto de terceiros não pode usar isso", () => {
    expect(azText("@ana veja", 400)).toBe(" @ana veja");
    expect(azText("@C:/segredo.txt", 400)).toBe(" @C:/segredo.txt");
    expect(azText("ver x=@C:/segredo.txt", 400)).toBe("ver x= @C:/segredo.txt");
    expect(azText("a@b.com", 400)).toBe("a@b.com");
  });

  test("limite: acima dele corta e termina com a nota; no limite fica como está; sem partir um par de substitutos", () => {
    expect(azText("x".repeat(200), 200)).toBe("x".repeat(200));
    const cut = azText("x".repeat(500), 200);
    expect(cut).toHaveLength(200);
    expect(cut.endsWith(AZ_CUT_NOTE)).toBe(true);
    expect(azText("y".repeat(401), 400)).toHaveLength(400);
    const emojis = azText("😀".repeat(300), 100);
    expect(Array.from(emojis)).toHaveLength(100);
    // No lone surrogate, which would make an invalid argument.
    expect(/[�-�](?![�-�])|(?<![�-�])[�-�]/.test(emojis)).toBe(false);
  });

  test("só os argumentos de texto livre do az são limpos, cada um com o seu limite", () => {
    expect(AZ_TEXT_FLAGS).toMatchObject({ "--title": 200, "--description": 400 });
    const out = sanitizeAzArgs([
      "repos",
      "pr",
      "create",
      "--title",
      "a\nb",
      "--description",
      "x<y",
      "--source-branch",
      "fd/x",
      "--discussion",
      "z|w",
      "--output",
      "json",
    ]);
    expect(out).toEqual([
      "repos",
      "pr",
      "create",
      "--title",
      "a — b",
      "--description",
      "x(y",
      "--source-branch",
      "fd/x",
      "--discussion",
      "z/w",
      "--output",
      "json",
    ]);
    expect(azText("t".repeat(300), AZ_TEXT_FLAGS["--title"] as number)).toHaveLength(200);
    expect(sanitizeAzArgs(["x", "--title"])).toEqual(["x", "--title"]);
  });

  test("a WIQL não é prosa: só as quebras viram espaço; o que o .cmd recusa segue e o erro é claro", () => {
    expect(
      sanitizeAzArgs(["boards", "query", "--wiql", "SELECT [System.Id]\nFROM WorkItems"]),
    ).toEqual(["boards", "query", "--wiql", "SELECT [System.Id] FROM WorkItems"]);
    expect(sanitizeAzArgs(["--wiql", "A <> B"])).toEqual(["--wiql", "A <> B"]);
  });

  test("o erro do Bun para o .cmd vira invalid_state com o motivo; outro erro segue como é", () => {
    const refusal = Object.assign(new TypeError("contains a cmd.exe special character"), {
      code: "ERR_INVALID_ARG_VALUE",
    });
    let caught: unknown;
    try {
      mapSpawnError(refusal);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "invalid_state" });
    expect((caught as Error).message).toContain("az");
    const other = new Error("outro");
    expect(() => mapSpawnError(other)).toThrow(other);
  });
});
