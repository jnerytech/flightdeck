/**
 * The models' public entry in the app (#1589, #4216): the Claude models a person can choose, how
 * each reads ("Opus 5.5"), and the efforts a model takes. The session's model menu, the persona
 * editor and the assistant's settings list the same models from here. Another domain imports from
 * here, never a file inside.
 */

export { EFFORTS, isCurrentModel, MAIN_MODELS, MORE_MODELS, modelName } from "./domain/models.ts";
