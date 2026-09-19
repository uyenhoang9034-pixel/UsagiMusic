import {
  getMusicButtonHandlerIds,
  musicButtonHandler,
} from '../../../handlers/musicButtons.js';

export default getMusicButtonHandlerIds().map((name) => ({
  name,
  execute: musicButtonHandler.execute,
}));
