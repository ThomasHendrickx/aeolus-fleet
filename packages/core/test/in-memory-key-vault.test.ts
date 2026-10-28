import { createInMemoryKeyVault } from './support/in-memory-key-vault.js';
import { describeKeyVault } from './support/key-vault-contract.js';

describeKeyVault('the in-memory key vault', createInMemoryKeyVault);
