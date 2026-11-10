.PHONY: start setup native-build native-install native-run native-test

start:
	@npm start

setup:
	@npm start

native-build:
	@./scripts/build-macos-native.sh

native-install:
	@./scripts/install-macos-native.sh

native-run:
	@./scripts/install-macos-native.sh --launch

native-test:
	@./dist/native-macos/KobeanSQL.app/Contents/MacOS/KobeanSQL --self-test
