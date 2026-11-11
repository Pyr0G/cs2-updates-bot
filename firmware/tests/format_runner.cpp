#include "../src/patchnotes.h"
#include <fstream>
#include <iostream>
#include <iterator>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif
int main(int argc, char **argv) {
    if (argc != 2) return 3;
#ifdef _WIN32
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::ifstream input(argv[1], std::ios::binary);
    std::string source((std::istreambuf_iterator<char>(input)), {});
    std::vector<std::string> parts;
    if (!patchnotes::descriptions(source, parts)) return 2;
    for (const auto &part : parts) std::cout << part << "\x1e";
}
