# Defi for Good Smart Contracts

This repository contains a set of Defi for Good smart contracts. A proof of concept implementation of this "Defi for Good" is the "Purpose for Profit (PFP)" protocol.

PFP is a decentralized autonomous organization (or DAO) and supporting foundation enabling tokenized impact investing for environmental social governance (ESG) initiatives.

This is not an officially supported Google product.

## Install Dependencies

```bash
yarn
```

## Compile Contracts

```bash
yarn compile
```

## Run Tests

```bash
yarn test
```

### Linting

```bash
yarn lint
# or fix
yarn lint-fix
```

### Coverage

```bash
yarn test-with-coverage
```

### Documentation

```bash
yarn docgen
```

### Slither

```bash
yarn slither

# upgradeability checks:
yarn slither-upgradeability

# erc20 token checks:
yarn slither-erc20
```
