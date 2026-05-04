#ifndef GF_WIDE_H
#define GF_WIDE_H

/* GF(2^16) arithmetic — primitive polynomial x^16+x^5+x^3+x^2+1 (0x1002D).
   Call gf16_init() once before any other gf16_* function.                   */

#include <stdint.h>

void     gf16_init(void);
uint16_t gf16_mul(uint16_t a, uint16_t b);
uint16_t gf16_inv(uint16_t a);
uint16_t gf16_div(uint16_t a, uint16_t b);

#endif /* GF_WIDE_H */
