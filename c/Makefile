CC      = cc
CFLAGS  = -std=c99 -O2 -Wall -Wextra -Wpedantic
LDFLAGS = -lm
TARGET  = gf-analyze
SRCS    = main.c gf256.c gf_wide.c bm.c bm_wide.c analyze.c
OBJS    = $(SRCS:.c=.o)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJS) $(TARGET)

# Header dependencies
main.o:     main.c gf256.h analyze.h
gf256.o:    gf256.c gf256.h
gf_wide.o:  gf_wide.c gf_wide.h
bm.o:       bm.c bm.h gf256.h
bm_wide.o:  bm_wide.c bm_wide.h gf_wide.h
analyze.o:  analyze.c analyze.h bm.h bm_wide.h gf256.h gf_wide.h

.PHONY: all clean
