export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^../../../shared/(.*)$': '<rootDir>/../shared/$1',
  },
};
