# Acme Embedded C Style Guide

This document describes how we write C in the firmware team. Read it before
your first PR. Above all, write code that is readable and that a new team
member can follow without a guided tour.

## Naming

Functions and variables must use snake_case. Macros and enum constants must
always be written in UPPER_CASE. Never begin an identifier with an
underscore; those names are reserved for the toolchain. Type names created
with typedef should end with the `_t` suffix.

Try to pick names that reveal intent. Use common sense when abbreviating.

## Layout and structure

Indent with 4 spaces; tabs are not allowed anywhere in the tree. Opening
braces for functions must go on their own line. Keep lines under 100
characters. Functions should not exceed 60 lines; if you are over, it is
usually a sign the function is doing too much.

For control statements (if, for, while, switch), the opening brace must be
placed on the same line as the keyword. Note that all opening braces,
including those of control statements, belong on their own line for
consistency with our function style.

## Memory and error handling

Always check the return value of malloc and calloc before using the
pointer. Never cast the result of malloc in C code. Every function that can
fail must return a negative errno-style code, and callers must check it.
Avoid memory leaks; the code should be efficient and fast.

Do not call malloc or any other heap allocation function inside an
interrupt handler.

## Headers and includes

Every header file must have an include guard using the `#ifndef` pattern;
`#pragma once` is not portable enough for our compilers. System includes
come before project includes, separated by a blank line.

Header files must use include guards written with `#ifndef`, `#define`, and
`#endif`.

## Comments and documentation

Every public function declared in a header must have a Doxygen comment
block describing parameters and the return value. Prefer `/* */` block
comments over `//` in code that must compile as C89. Comments should add
value and not restate the obvious.

## Miscellaneous

Never use `goto` except for the single cleanup-label error path pattern.
The `static` keyword must be applied to every function that is not part of
the public API. Discuss any change touching the boot sequence with the
platform team before opening a PR. And remember: when in doubt, keep it
simple.
