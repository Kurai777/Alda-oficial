import bcrypt from 'bcrypt';

const password = '06542085';
const saltRounds = 10;

try {
  const hash = bcrypt.hashSync(password, saltRounds);
  console.log(hash);
} catch (error) {
  console.error('Erro ao gerar hash:', error);
  process.exit(1);
} 