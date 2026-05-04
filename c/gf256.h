#ifndef GF256_H
#define GF256_H

/* GF(2^8) arithmetic — AES irreducible polynomial x^8+x^4+x^3+x+1.
   Call gf256_init() once before any other gf_* function.            */

#include <stdint.h>

void    gf256_init(void);

/* Addition = XOR in characteristic 2 */
static inline uint8_t gf_add(uint8_t a, uint8_t b) { return a ^ b; }

uint8_t gf_mul(uint8_t a, uint8_t b);
uint8_t gf_inv(uint8_t a);          /* undefined for a=0; returns 0 */
uint8_t gf_div(uint8_t a, uint8_t b);

/* Multiplicative order of a in GF(2^8)*: smallest k>=1 with a^k=1.
   Returns 0 for a=0. Divisors of 255: 1,3,5,15,17,51,85,255.       */
int     gf_order(uint8_t a);

#endif /* GF256_H */
