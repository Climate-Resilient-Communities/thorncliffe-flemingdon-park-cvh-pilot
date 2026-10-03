// Allowed: a resident query reads the views declared beside it.
import { nondrillAlert } from "./views";

export const readThreads = () => nondrillAlert.name;
