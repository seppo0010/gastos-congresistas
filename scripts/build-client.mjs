import { build } from 'vite';

try {
  await build();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
